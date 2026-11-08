import { lazy, Suspense, useEffect } from 'react';
import { Toasts } from './ui/components';
import { useRoute } from './core/store/route';
import { Library } from './features/library/Library';
import { NewPlanDialog } from './features/library/NewPlanDialog';
import { AreaDownloadDialog } from './features/areas/AreaDownloadDialog';
import { ShortcutsDialog } from './features/workspace/ShortcutsDialog';
import { ImportDialog } from './features/share/ImportDialog';
import { showDialog } from './core/store/dialogs';
import { decodePlanLink, LINK_PREFIX } from './core/files/link';
import { startAutosave } from './core/storage/projects';
import { registerPwa } from './core/pwa';
import { onMutationRejected } from './core/store/project';
import { toast } from './core/store/ui';
import { t } from './i18n';

const Workspace = lazy(() => import('./features/workspace/Workspace').then((module) => ({ default: module.Workspace })));

type LaunchParams = { files: { getFile: () => Promise<File> }[] };

/** Files opened with the installed app (PWA file handlers) and plans arriving as `#plan=` links. */
async function receiveLaunch() {
    const queue = (window as unknown as { launchQueue?: { setConsumer: (fn: (params: LaunchParams) => void) => void } }).launchQueue;
    queue?.setConsumer((params) => {
        const handle = params.files[0];
        if (handle) {
            void handle.getFile().then((file) => showDialog('import', { file }));
        }
    });
    if (location.hash.startsWith(LINK_PREFIX)) {
        const hash = location.hash;
        // Drop the plan from the address bar and history right away.
        history.replaceState(null, '', location.pathname + location.search);
        try {
            const project = await decodePlanLink(hash);
            showDialog('import', { result: { kind: 'project', project, source: 'link', unaligned: [], skipped: 0, missingAssets: 0 } });
        } catch (error) {
            console.warn('plan link rejected', error);
            toast(t('import.errorInvalid'), { tone: 'danger' });
        }
    }
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
        return () => {
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
            <Toasts />
        </>
    );
}
