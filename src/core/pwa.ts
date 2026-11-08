import { create } from 'zustand';
import { APP_VERSION, BUILD, isBuildInfo, sameBuild, type BuildInfo } from '../version';
import { flushNow } from './storage/projects';
import { db } from './storage/db';
import { mayAutoDownload } from './net';
import { toast, useUi, type Mode } from './store/ui';
import { useProject } from './store/project';
import { showDialog } from './store/dialogs';
import { t } from '../i18n';

/**
 * - `idle`: not checked yet · `checking`: asking the server · `current`: the server has this build
 * - `available`: the server has another build, not downloaded yet (data saver, or no service worker)
 * - `downloading`: the new version installs in the background · `ready`: installed, waiting for a tap
 * - `applying`: saving, then reloading · `reload`: another tab switched to a new version; this one must reload
 * - `offline` / `failed`: the last manual check could not reach the server
 */
export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'applying' | 'reload' | 'offline' | 'failed';

interface PwaState {
    offlineReady: boolean;
    status: UpdateStatus;
    /** The build on the server, when it differs from the running one. */
    available: BuildInfo | null;
    lastCheck: number | null;
}

export const usePwa = create<PwaState>(() => ({ offlineReady: false, status: 'idle', available: null, lastCheck: null }));

const CHECK_EVERY_MS = 60 * 60 * 1000;
const RECHECK_AFTER_MS = 15 * 60 * 1000;
const RESUME_KEY = 'as-tac.resume';
const SEEN_KEY = 'as-tac.version';
const RECOVER_KEY = 'as-tac.recovered';

let registration: ServiceWorkerRegistration | null = null;
let applying = false;
let checking: Promise<void> | null = null;

type Guard = () => string | null | Promise<string | null>;
const guards = new Set<Guard>();

/**
 * Something that must happen (or block) before the app reloads into a new version: e.g. a running
 * path recording (in memory only) blocks, the live queue finishes writing. Return a message to block.
 */
export function onBeforeUpdate(guard: Guard): () => void {
    guards.add(guard);
    return () => {
        guards.delete(guard);
    };
}

/** Register the service worker (production builds) and start looking for updates. */
export async function registerPwa() {
    announceUpdate();
    // Another tab opened the database with a newer schema (a newer app): Dexie closes and reopens
    // the connection on its own; this page's code is older and should reload.
    db.on('versionchange', (event: IDBVersionChangeEvent) => {
        if (!applying && event.newVersion && event.newVersion / 10 > db.verno) {
            usePwa.setState({ status: 'reload' });
        }
    });
    // Our upgrade waits for a window that still holds the old version open.
    db.on('blocked', () => {
        toast(t('storage.blocked'), { tone: 'warn' });
    });
    window.addEventListener('vite:preloadError', (event) => {
        event.preventDefault();
        void recoverFromStaleBuild();
    });
    if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
        let controlled = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!controlled) {
                // First install takes control of this page; nothing changed for it.
                controlled = true;
                return;
            }
            if (!applying) {
                // Another tab switched to a new version; this page still runs the old code.
                usePwa.setState({ status: 'reload' });
            }
        });
        try {
            const { registerSW } = await import('virtual:pwa-register');
            registerSW({
                immediate: true,
                onNeedRefresh() {
                    markReady();
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
    window.addEventListener('online', again);
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

/**
 * Ask the server for its build. Background checks stay quiet and only download a new version
 * where large downloads are allowed (data saver); a manual check always reports and downloads.
 */
export function checkForUpdate(manual = false): Promise<void> {
    if (manual && !checking && !busy()) {
        usePwa.setState({ status: navigator.onLine ? 'checking' : 'offline' });
    }
    checking ??= runCheck(manual).finally(() => {
        checking = null;
    });
    return checking;
}

function busy(): boolean {
    const status = usePwa.getState().status;
    return status === 'downloading' || status === 'ready' || status === 'applying' || status === 'reload';
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
            usePwa.setState({ available: remote });
        }
        return;
    }
    if (!remote) {
        if (manual || usePwa.getState().status === 'checking') {
            usePwa.setState({ status: navigator.onLine ? 'failed' : 'offline' });
        }
        return;
    }
    if (sameBuild(remote, BUILD)) {
        usePwa.setState({ status: 'current', available: null });
        return;
    }
    usePwa.setState({ available: remote, status: 'available' });
    if (registration && (manual || mayAutoDownload())) {
        await download();
    }
}

function markReady() {
    usePwa.setState((state) => (state.status === 'applying' || state.status === 'reload' ? state : { status: 'ready' }));
    if (!usePwa.getState().available) {
        void serverBuild().then((remote) => {
            if (remote && !sameBuild(remote, BUILD)) {
                usePwa.setState({ available: remote });
            }
        });
    }
}

/** Resolves when a new worker is installed (true) or was thrown away (false). */
function watchInstall(worker: ServiceWorker): Promise<boolean> {
    if (usePwa.getState().status !== 'ready') {
        usePwa.setState({ status: 'downloading' });
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
 * Switch to the new version: blockers first (e.g. a running path recording), then every unsaved
 * edit is written, then the page reloads into the new version and reopens the plan it showed.
 */
export async function applyUpdate(): Promise<boolean> {
    const status = usePwa.getState().status;
    if (applying || status === 'downloading' || status === 'applying') {
        return false;
    }
    for (const guard of guards) {
        const reason = await guard();
        if (reason) {
            toast(reason, { tone: 'warn' });
            return false;
        }
    }
    if (status !== 'reload' && registration && !registration.waiting) {
        if (!(await download())) {
            toast(t(navigator.onLine ? 'update.failed' : 'update.offline'), { tone: 'warn' });
            return false;
        }
        // Downloading took a while: check the blockers and save again before switching.
        return applyUpdate();
    }
    if (!(await flushNow())) {
        toast(t('update.saveFailed'), { tone: 'danger' });
        return false;
    }
    applying = true;
    usePwa.setState({ status: 'applying' });
    rememberResume();
    const waiting = status === 'reload' ? null : registration?.waiting;
    if (waiting) {
        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
        waiting.postMessage({ type: 'SKIP_WAITING' });
        // Should the switch not be reported (some browsers), reload anyway: the new worker is then active or still waiting.
        window.setTimeout(() => window.location.reload(), 10000);
    } else {
        window.location.reload();
    }
    return true;
}

/**
 * This page runs an older build than the server (files of the old version are gone): save, then
 * reload once into the current version. A second failure within a minute is reported instead.
 */
export async function recoverFromStaleBuild(): Promise<void> {
    if (applying) {
        return;
    }
    let recent = false;
    try {
        recent = Date.now() - Number(sessionStorage.getItem(RECOVER_KEY) ?? 0) < 60000;
        sessionStorage.setItem(RECOVER_KEY, String(Date.now()));
    } catch {
        recent = true;
    }
    if (recent) {
        usePwa.setState({ status: 'reload' });
        toast(t('update.reloadNeeded'), { tone: 'warn', action: { label: t('update.reload'), run: () => void applyUpdate() } });
        return;
    }
    if (!(await flushNow())) {
        usePwa.setState({ status: 'reload' });
        toast(t('update.saveFailed'), { tone: 'danger' });
        return;
    }
    applying = true;
    rememberResume();
    window.location.reload();
}

type Resume = { projectId: string; mode: Mode };

function rememberResume() {
    const project = useProject.getState().project;
    try {
        if (project) {
            sessionStorage.setItem(RESUME_KEY, JSON.stringify({ projectId: project.id, mode: useUi.getState().mode, at: Date.now() }));
        }
    } catch {
        // Without storage the app starts in the library after the update.
    }
}

/** The plan (and mode) that was open when the page reloaded into a new version, once. */
export function takeResume(): Resume | null {
    try {
        const raw = sessionStorage.getItem(RESUME_KEY);
        sessionStorage.removeItem(RESUME_KEY);
        const value = raw ? (JSON.parse(raw) as Partial<Resume> & { at?: number }) : null;
        if (!value || typeof value.projectId !== 'string' || typeof value.at !== 'number' || Date.now() - value.at > 5 * 60 * 1000) {
            return null;
        }
        const mode: Mode = value.mode === 'field' || value.mode === 'briefing' ? value.mode : 'plan';
        return { projectId: value.projectId, mode };
    } catch {
        return null;
    }
}

/** After an update: say so once, with a way to see what changed. */
function announceUpdate() {
    let last: string | null = null;
    try {
        last = localStorage.getItem(SEEN_KEY);
        localStorage.setItem(SEEN_KEY, APP_VERSION);
    } catch {
        return;
    }
    if (last && last !== APP_VERSION) {
        toast(t('update.done', { v: APP_VERSION }), { tone: 'ok', action: { label: t('update.whatsNew'), run: () => showDialog('whatsNew') } });
    }
}
