import { create } from 'zustand';
import { APP_VERSION, BUILD, compareVersions, isBuildInfo, sameBuild, type BuildInfo } from '../version';
import { flushNow, savedAs } from './storage/projects';
import { db } from './storage/db';
import { mayAutoDownload } from './net';
import { toast, useUi, type Mode } from './store/ui';
import { freezeLocalEdits, useProject } from './store/project';
import { showDialog } from './store/dialogs';
import { t } from '../i18n';

/**
 * - `idle`: not checked yet · `checking`: asking the server · `current`: the server has this build
 * - `available`: the server has another build, not downloaded yet (data saver, a tap, or no service worker)
 * - `downloading`: the new version installs in the background · `ready`: installed, waiting for a tap
 * - `applying`: saving, then reloading (edits are frozen) · `reload`: another tab switched to a new
 *   version (or this page's files are gone); this page must reload
 * - `offline` / `failed`: the last check could not reach the server
 */
export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'applying' | 'reload' | 'offline' | 'failed';

interface PwaState {
    offlineReady: boolean;
    status: UpdateStatus;
    /** The build on the server, when it differs from the running one. */
    available: BuildInfo | null;
    /** The server's build is an older version (a rollback): never downloaded without a tap. */
    older: boolean;
    lastCheck: number | null;
}

export const usePwa = create<PwaState>(() => ({ offlineReady: false, status: 'idle', available: null, older: false, lastCheck: null }));

const CHECK_EVERY_MS = 60 * 60 * 1000;
const RECHECK_AFTER_MS = 15 * 60 * 1000;
const RESUME_KEY = 'as-tac.resume';
const SEEN_KEY = 'as-tac.version';
const RECOVER_KEY = 'as-tac.recovered';

let registration: ServiceWorkerRegistration | null = null;
let applying = false;
let checking: Promise<void> | null = null;
let applyRun: Promise<boolean> | null = null;
let recovering: Promise<void> | null = null;

type Guard = () => string | null | Promise<string | null>;
const guards = new Set<Guard>();

/**
 * Something that must happen (or block) before the app reloads into a new version: e.g. a running
 * path recording (in memory only) blocks, the live queue finishes writing. Return a message to block.
 * Guards run again right before the reload, when their message is ignored (only their waiting counts).
 */
export function onBeforeUpdate(guard: Guard): () => void {
    guards.add(guard);
    return () => {
        guards.delete(guard);
    };
}

// Work that exists only in this page and would vanish with a reload.
onBeforeUpdate(() => {
    const ui = useUi.getState();
    return ui.draft || ui.briefingInk.length > 0 || ui.streamerInk.length > 0 ? t('update.blockedDraft') : null;
});

async function blocker(): Promise<string | null> {
    for (const guard of guards) {
        const reason = await guard();
        if (reason) {
            return reason;
        }
    }
    return null;
}

let registered = false;

/** Register the service worker (production builds) and start looking for updates. Once per page. */
export async function registerPwa() {
    if (registered) {
        return;
    }
    registered = true;
    announceUpdate();
    // Another tab opened the database with a newer schema (a newer app): Dexie closes and reopens
    // the connection on its own; this page's code is older and should reload.
    db.on('versionchange', (event: IDBVersionChangeEvent) => {
        if (!applying && event.newVersion && Math.floor(event.newVersion / 10) > db.verno) {
            usePwa.setState({ status: 'reload' });
        }
    });
    // Our upgrade waits for a window that still holds the old version open.
    db.on('blocked', () => {
        toast(t('storage.blocked'), { tone: 'warn' });
    });
    // Files of this build are gone from the server (an update happened): reload once, saved.
    // (Not prevented: the failed import then rejects and its caller shows a way out.)
    window.addEventListener('vite:preloadError', () => {
        void recoverFromStaleBuild();
    });
    if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
        // Only the very first install may take over this page silently; any later switch of the
        // controlling worker means another tab applied an update (also for a hard-reloaded page).
        const before = await navigator.serviceWorker.getRegistration().catch(() => undefined);
        let firstInstall = !before?.active;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (applying) {
                void finishReload();
                return;
            }
            if (firstInstall) {
                firstInstall = false;
                return;
            }
            usePwa.setState({ status: 'reload' });
        });
        try {
            const { registerSW } = await import('virtual:pwa-register');
            registerSW({
                immediate: true,
                onNeedRefresh() {
                    markReady();
                },
                // Without this, the plugin reloads every tab the moment any tab applies the update —
                // unsaved and unguarded. This page reloads itself only through applyUpdate().
                onNeedReload() {
                    if (!applying) {
                        usePwa.setState({ status: 'reload' });
                    }
                },
                onOfflineReady() {
                    usePwa.setState({ offlineReady: true });
                },
                onRegisteredSW(_url, reg) {
                    registration = reg ?? null;
                    if (reg?.active) {
                        usePwa.setState({ offlineReady: true });
                    }
                    if (reg?.waiting && navigator.serviceWorker.controller) {
                        markReady();
                    }
                    // Updates the browser finds by itself (e.g. on a later page load).
                    reg?.addEventListener('updatefound', () => {
                        const worker = reg.installing;
                        if (worker && navigator.serviceWorker.controller) {
                            void watchInstall(worker);
                        }
                    });
                },
            });
        } catch (error) {
            console.warn('service worker registration failed', error);
        }
    }
    scheduleChecks();
}

function scheduleChecks() {
    // Not right at start: the first seconds belong to loading the plan and the map.
    window.setTimeout(() => void checkForUpdate(), 8000);
    window.setInterval(() => {
        if (document.visibilityState === 'visible') {
            void checkForUpdate();
        }
    }, CHECK_EVERY_MS);
    const again = () => {
        const last = usePwa.getState().lastCheck;
        if (document.visibilityState === 'visible' && (!last || Date.now() - last > RECHECK_AFTER_MS)) {
            void checkForUpdate();
        }
    };
    window.addEventListener('online', () => {
        if (usePwa.getState().status === 'offline') {
            usePwa.setState({ status: 'idle' });
        }
        again();
    });
    document.addEventListener('visibilitychange', again);
}

/** What the server has now (`/version.json`, never cached). */
async function serverBuild(): Promise<BuildInfo | null> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
            return null;
        }
        const text = await response.text();
        if (text.length > 2000) {
            return null;
        }
        const value = JSON.parse(text) as unknown;
        return isBuildInfo(value) ? value : null;
    } catch {
        return null;
    } finally {
        window.clearTimeout(timer);
    }
}

/** Whether a service worker can download the update in the background (else applying reloads from the server). */
export function canDownload(): boolean {
    return Boolean(registration);
}

function busy(): boolean {
    const status = usePwa.getState().status;
    return status === 'downloading' || status === 'ready' || status === 'applying' || status === 'reload';
}

/**
 * Ask the server for its build. Background checks stay quiet and download a newer version only
 * where large downloads are allowed (data saver); a manual check always reports and downloads.
 * An older build on the server (rollback) is only reported.
 */
let manualQueued: Promise<void> | null = null;

export function checkForUpdate(manual = false): Promise<void> {
    if (manual && !busy()) {
        usePwa.setState({ status: navigator.onLine ? 'checking' : 'offline' });
    }
    if (checking) {
        // A manual check during a background one: report on the next round, as a manual check (once).
        if (!manual) {
            return checking;
        }
        manualQueued ??= checking.finally(() => {
            manualQueued = null;
        }).then(() => checkForUpdate(true));
        return manualQueued;
    }
    checking = runCheck(manual).finally(() => {
        checking = null;
    });
    return checking;
}

async function runCheck(manual: boolean) {
    if (!navigator.onLine) {
        if (manual && !busy()) {
            usePwa.setState({ status: 'offline' });
        }
        return;
    }
    const remote = await serverBuild();
    usePwa.setState({ lastCheck: Date.now() });
    if (busy()) {
        if (remote && !sameBuild(remote, BUILD)) {
            usePwa.setState({ available: remote, older: compareVersions(remote.version, APP_VERSION) < 0 });
        }
        return;
    }
    if (!remote) {
        const status = usePwa.getState().status;
        if (manual || status === 'checking' || status === 'offline' || status === 'failed') {
            usePwa.setState({ status: navigator.onLine ? 'failed' : 'offline' });
        }
        return;
    }
    if (sameBuild(remote, BUILD)) {
        usePwa.setState({ status: 'current', available: null, older: false });
        return;
    }
    const older = compareVersions(remote.version, APP_VERSION) < 0;
    usePwa.setState({ available: remote, older, status: 'available' });
    if (registration && !older && (manual || mayAutoDownload())) {
        await download();
    }
}

function markReady() {
    usePwa.setState((state) => (state.status === 'applying' || state.status === 'reload' ? state : { status: 'ready' }));
    if (!usePwa.getState().available) {
        void serverBuild().then((remote) => {
            if (remote && !sameBuild(remote, BUILD)) {
                usePwa.setState({ available: remote, older: compareVersions(remote.version, APP_VERSION) < 0 });
            }
        });
    }
}

/** Resolves when a new worker is installed (true) or was thrown away (false). */
function watchInstall(worker: ServiceWorker): Promise<boolean> {
    if (!busy()) {
        usePwa.setState({ status: 'downloading' });
    }
    if (!usePwa.getState().available) {
        // Found by the browser itself: say which version is coming (also when it is an older one).
        void serverBuild().then((remote) => {
            if (remote && !sameBuild(remote, BUILD)) {
                usePwa.setState({ available: remote, older: compareVersions(remote.version, APP_VERSION) < 0 });
            }
        });
    }
    return new Promise((resolve) => {
        const settle = () => {
            if (worker.state === 'installed' || worker.state === 'activating' || worker.state === 'activated') {
                worker.removeEventListener('statechange', settle);
                markReady();
                resolve(true);
            } else if (worker.state === 'redundant') {
                worker.removeEventListener('statechange', settle);
                usePwa.setState((state) => (state.status === 'downloading' ? { status: 'failed' } : state));
                resolve(false);
            }
        };
        worker.addEventListener('statechange', settle);
        settle();
    });
}

/** Install the server's version in the background (the service worker downloads the changed files). */
async function download(): Promise<boolean> {
    const reg = registration;
    if (!reg) {
        return false;
    }
    if (reg.waiting) {
        markReady();
        return true;
    }
    usePwa.setState({ status: 'downloading' });
    try {
        await reg.update();
    } catch {
        usePwa.setState({ status: navigator.onLine ? 'failed' : 'offline' });
        return false;
    }
    const worker = reg.waiting ?? reg.installing;
    if (!worker) {
        // The worker script is unchanged although the version file differs (deploy in progress).
        usePwa.setState({ status: 'available' });
        return false;
    }
    return watchInstall(worker);
}

/**
 * The update button. Not downloaded yet: download only (a second tap applies, so the page never
 * reloads minutes after a tap). Ready (or another tab already switched): blockers first (a running
 * path recording, an unfinished drawing), then every edit is saved, edits freeze, and the page
 * reloads into the new version and reopens the same plan in the same mode and privacy view.
 */
export function applyUpdate(): Promise<boolean> {
    applyRun ??= runApply().finally(() => {
        applyRun = null;
    });
    return applyRun;
}

async function runApply(): Promise<boolean> {
    const status = usePwa.getState().status;
    if (applying || status === 'downloading' || status === 'applying') {
        return false;
    }
    if (status === 'available' && registration) {
        if (!(await download())) {
            toast(t(navigator.onLine ? 'update.failed' : 'update.offline'), { tone: 'warn' });
        }
        return false;
    }
    const reason = await blocker();
    if (reason) {
        toast(reason, { tone: 'warn' });
        return false;
    }
    if (!(await flushNow())) {
        toast(t('update.saveFailed'), { tone: 'danger' });
        return false;
    }
    applying = true;
    freezeLocalEdits();
    usePwa.setState({ status: 'applying' });
    rememberResume();
    const waiting = status === 'reload' ? null : registration?.waiting;
    if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        // Should the switch not be reported (some browsers), reload anyway: the new worker is then active or still waiting.
        window.setTimeout(() => void finishReload(), 10000);
    } else {
        void finishReload();
    }
    return true;
}

let reloading = false;

/** Last writes (live queue, a remote change saved since), then the reload. Blocking messages no longer apply. */
async function finishReload() {
    if (reloading) {
        return;
    }
    reloading = true;
    // Mode or privacy view may have changed by shortcut since the tap.
    rememberResume();
    const last = (async () => {
        for (const guard of guards) {
            await Promise.resolve().then(guard).catch(() => null);
        }
        await flushNow().catch(() => false);
        // The last save may have gone to a copy (a newer window took the plan over meanwhile).
        rememberResume();
    })();
    // A stalled write must not keep the "updating" screen up for ever.
    await Promise.race([last, new Promise((resolve) => window.setTimeout(resolve, 5000))]);
    window.location.reload();
}

/**
 * This page runs an older build than the server (files of the old version are gone): save, then
 * reload once into the current version. A second failure within a minute, or a blocker (e.g. a
 * running recording), leaves the choice to the user (status `reload`).
 */
export function recoverFromStaleBuild(): Promise<void> {
    recovering ??= runRecover();
    return recovering;
}

async function runRecover() {
    if (applying) {
        return;
    }
    let recent = false;
    try {
        recent = Date.now() - Number(sessionStorage.getItem(RECOVER_KEY) ?? 0) < 60000;
    } catch {
        recent = true;
    }
    usePwa.setState({ status: 'reload' });
    const reason = recent ? null : await blocker();
    if (recent || reason || !(await flushNow())) {
        toast(reason ?? t('update.reloadNeeded'), { tone: 'warn', action: { label: t('update.reload'), run: () => void applyUpdate() } });
        recovering = null;
        return;
    }
    try {
        sessionStorage.setItem(RECOVER_KEY, String(Date.now()));
    } catch {
        // Without storage a second failure is simply reported again.
    }
    applying = true;
    freezeLocalEdits();
    rememberResume();
    await finishReload();
}

type Streamer = ReturnType<typeof useUi.getState>['streamer'];
type Resume = { projectId: string; mode: Mode; streamer: Streamer };

function rememberResume() {
    const project = useProject.getState().project;
    const ui = useUi.getState();
    try {
        if (project) {
            // Where this window's edits are stored (a copy, if a newer app took the plan over).
            sessionStorage.setItem(RESUME_KEY, JSON.stringify({ projectId: savedAs(project.id), mode: ui.mode, streamer: ui.streamer, at: Date.now() }));
        }
    } catch {
        // Without storage the app starts in the library after the update.
    }
}

/** The plan, mode and Streamer Safe profile that were open when the page reloaded into a new version, once. */
export function takeResume(): Resume | null {
    try {
        const raw = sessionStorage.getItem(RESUME_KEY);
        sessionStorage.removeItem(RESUME_KEY);
        const value = raw ? (JSON.parse(raw) as Partial<Resume> & { at?: number }) : null;
        if (!value || typeof value.projectId !== 'string' || typeof value.at !== 'number' || Date.now() - value.at > 5 * 60 * 1000) {
            return null;
        }
        const mode: Mode = value.mode === 'field' || value.mode === 'briefing' ? value.mode : 'plan';
        const streamer: Streamer = value.streamer === 'field' || value.streamer === 'public' ? value.streamer : 'off';
        return { projectId: value.projectId, mode, streamer };
    } catch {
        return null;
    }
}

/** After an update (or a switch back to an older version): say so once, with a way to see what changed. */
function announceUpdate() {
    let last: string | null = null;
    try {
        last = localStorage.getItem(SEEN_KEY);
        localStorage.setItem(SEEN_KEY, APP_VERSION);
    } catch {
        return;
    }
    if (last && last !== APP_VERSION) {
        const older = compareVersions(APP_VERSION, last) < 0;
        toast(t(older ? 'update.switched' : 'update.done', { v: APP_VERSION }), { tone: older ? 'warn' : 'ok', action: { label: t('update.whatsNew'), run: () => showDialog('whatsNew') } });
    }
}
