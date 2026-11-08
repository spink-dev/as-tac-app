import { lazy, Suspense, useEffect } from 'react';
import { Toasts } from './ui/components';
import { useRoute } from './core/store/route';
import { Library } from './features/library/Library';
import { NewPlanDialog } from './features/library/NewPlanDialog';
import { AreaDownloadDialog } from './features/areas/AreaDownloadDialog';
import { ShortcutsDialog } from './features/workspace/ShortcutsDialog';
import { startAutosave } from './core/storage/projects';
import { registerPwa } from './core/pwa';
import { onMutationRejected } from './core/store/project';
import { toast } from './core/store/ui';
import { t } from './i18n';

const Workspace = lazy(() => import('./features/workspace/Workspace').then((module) => ({ default: module.Workspace })));

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
            <Toasts />
        </>
    );
}
