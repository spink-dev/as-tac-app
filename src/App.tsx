import { lazy, Suspense, useEffect } from 'react';
import { Toasts } from './ui/components';
import { openProject, useRoute } from './core/store/route';
import { Library } from './features/library/Library';
import { NewPlanDialog } from './features/library/NewPlanDialog';
import { AreaDownloadDialog } from './features/areas/AreaDownloadDialog';
import { ShortcutsDialog } from './features/workspace/ShortcutsDialog';
import { ImportDialog, importErrorText } from './features/share/ImportDialog';
import { JoinDialog } from './features/live/JoinDialog';
import { CreditsDialog } from './features/library/CreditsDialog';
import { showDialog } from './core/store/dialogs';
import { decodePlanLink, JOIN_PREFIX, LINK_PREFIX } from './core/files/link';
import { pruneBackups, startAutosave } from './core/storage/projects';
import { recoverFromStaleBuild, registerPwa, takeResume } from './core/pwa';
import { StaleBuild, UpdatingOverlay, WhatsNewDialog } from './features/update/Update';
import { onMutationRejected } from './core/store/project';
import { toast } from './core/store/ui';
import { t } from './i18n';

// A page from an older build may find its files gone after an update: reload into the current one
// (saved), or, if that already failed once, offer the reload instead of an endless loading screen.
const Workspace = lazy(() => import('./features/workspace/Workspace').then((module) => ({ default: module.Workspace })).catch((error: unknown) => {
    console.warn('workspace chunk failed to load', error);
    void recoverFromStaleBuild();
    return { default: StaleBuild };
}));

type LaunchParams = { files: { getFile: () => Promise<File> }[] };

/** Files opened with the installed app (PWA file handlers) and plans arriving as `#plan=` links. */
async function receiveLaunch() {
    const queue = (window as unknown as { launchQueue?: { setConsumer: (fn: (params: LaunchParams) => void) => void } }).launchQueue;
    queue?.setConsumer((params) => {
        const handle = params.files[0];
        if (handle) {
            void handle.getFile().then((file) => showDialog('import', { file })).catch(() => toast(t('import.errorFormat'), { tone: 'danger' }));
        }
    });
    // Files dropped anywhere open the import dialog instead of navigating away from the app.
    window.addEventListener('dragover', (event) => {
        if (event.dataTransfer?.types.includes('Files')) {
            event.preventDefault();
        }
    });
    window.addEventListener('drop', (event) => {
        const file = event.dataTransfer?.files[0];
        if (file && !event.defaultPrevented) {
            event.preventDefault();
            showDialog('import', { file });
        }
    });
    window.addEventListener('hashchange', () => void receiveLink());
    // Older invite links used `?join=`; they still open the dialog but leave no trace either.
    const params = new URLSearchParams(location.search);
    const legacyJoin = params.get('join');
    if (legacyJoin) {
        params.delete('join');
        const rest = params.toString();
        history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
        showDialog('join', { code: legacyJoin.slice(0, 16) });
    }
    await receiveLink();
}

async function receiveLink() {
    if (location.hash.startsWith(JOIN_PREFIX)) {
        // Invite links carry only the code in the fragment (never sent to a server or logged);
        // it goes into the join dialog and is removed from the address bar and history.
        const code = location.hash.slice(JOIN_PREFIX.length).slice(0, 16);
        history.replaceState(null, '', location.pathname + location.search);
        if (/^[A-Za-z0-9]{4,16}$/.test(code)) {
            showDialog('join', { code });
        }
        return;
    }
    if (location.hash.startsWith(LINK_PREFIX)) {
        const hash = location.hash;
        // Drop the plan from the address bar and history right away.
        history.replaceState(null, '', location.pathname + location.search);
        try {
            const project = await decodePlanLink(hash);
            showDialog('import', { result: { kind: 'project', project, source: 'link', unaligned: [], skipped: 0, missingAssets: 0 } });
        } catch (error) {
            console.warn('plan link rejected', error);
            toast(importErrorText(error), { tone: 'danger' });
        }
    }
}

/** After reloading into a new version: reopen the plan that was open, in the same mode and privacy view. */
function resumeAfterUpdate() {
    const resume = takeResume();
    if (!resume) {
        return;
    }
    const session = resume.mode === 'field'
        ? { mode: 'field' as const, tool: 'select' as const, panel: null, sheet: 'closed' as const }
        : resume.mode === 'briefing'
            ? { mode: 'briefing' as const, tool: 'select' as const, phaseIndex: 0, selection: [], panel: null, sheet: 'closed' as const }
            : {};
    void openProject(resume.projectId, false, { ...session, streamer: resume.streamer })
        .catch((error: unknown) => console.warn('could not reopen the plan after the update', error));
}

export function App() {
    const route = useRoute((state) => state.route);

    useEffect(() => {
        const stop = startAutosave();
        let last = 0;
        const stopRejected = onMutationRejected(() => {
            // One hint per burst, not one per keystroke.
            if (Date.now() - last > 4000) {
                last = Date.now();
                toast(t('common.rejected'), { tone: 'warn' });
            }
        });
        void registerPwa();
        void receiveLaunch();
        resumeAfterUpdate();
        const prune = window.setTimeout(() => void pruneBackups().catch(() => undefined), 15000);
        return () => {
            window.clearTimeout(prune);
            stop();
            stopRejected();
        };
    }, []);

    return (
        <>
            {route.name === 'library' ? (
                <Library />
            ) : (
                <Suspense fallback={<div className="boot"><span className="muted">AS-TAC</span></div>}>
                    <Workspace key={route.projectId} />
                </Suspense>
            )}
            <NewPlanDialog />
            <AreaDownloadDialog />
            <ShortcutsDialog />
            <ImportDialog />
            <JoinDialog />
            <CreditsDialog />
            <WhatsNewDialog />
            <UpdatingOverlay />
            <Toasts />
        </>
    );
}
