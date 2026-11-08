import { lazy, Suspense, useEffect } from 'react';
import { Toasts } from './ui/components';
import { useRoute } from './core/store/route';
import { Library } from './features/library/Library';
import { NewPlanDialog } from './features/library/NewPlanDialog';
import { AreaDownloadDialog } from './features/areas/AreaDownloadDialog';
import { startAutosave } from './core/storage/projects';
import { registerPwa } from './core/pwa';

const Workspace = lazy(() => import('./features/workspace/Workspace').then((module) => ({ default: module.Workspace })));

export function App() {
    const route = useRoute((state) => state.route);

    useEffect(() => {
        const stop = startAutosave();
        void registerPwa();
        return stop;
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
            <Toasts />
        </>
    );
}
