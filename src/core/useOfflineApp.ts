import { de } from '../i18n/de';
import { useCallback, useEffect, useRef, useState } from 'react';
import { verifyOffline, type OfflineStatus } from './offline';

export function useOfflineApp(canReload: () => boolean) {
    const [online, setOnline] = useState(true);
    const [offline, setOffline] = useState<OfflineStatus>({ ready: false });
    const [offlineText, setOfflineText] = useState(de.offline.unchecked);
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const [update, setUpdate] = useState<ServiceWorker | null>(null);
    const [storage, setStorage] = useState('');
    const alive = useRef(false);
    const reloadRequested = useRef(false);

    const verify = useCallback(async (repair = false) => {
        if (repair && !navigator.serviceWorker?.controller) {
            if (canReload()) {
                location.reload();
            }
            return;
        }
        const status = await verifyOffline(repair);
        if (alive.current) {
            setOffline(status);
            setOfflineText(status.ready ? de.offline.ready : (status.error ?? de.offline.incomplete));
        }
    }, [canReload]);

    useEffect(() => {
        alive.current = true;
        const connection = () => setOnline(navigator.onLine);
        connection();
        window.addEventListener('online', connection);
        window.addEventListener('offline', connection);
        const cleanup: (() => void)[] = [];
        const cleanupAll = () => {
            alive.current = false;
            window.removeEventListener('online', connection);
            window.removeEventListener('offline', connection);
            for (const remove of cleanup) {
                remove();
            }
        };
        if (!import.meta.env.PROD) {
            setOfflineText(de.offline.development);
            return cleanupAll;
        }
        if (!isSecureContext || !('serviceWorker' in navigator)) {
            setOfflineText(de.offline.unsupported);
            return cleanupAll;
        }
        const controllerChanged = () => {
            if (reloadRequested.current && canReload()) {
                location.reload();
                return;
            }
            setUpdate(null);
            void verify();
        };
        const visibility = () => {
            if (document.visibilityState === 'visible') {
                void verify();
            }
        };
        navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
        document.addEventListener('visibilitychange', visibility);
        cleanup.push(() => navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged),
            () => document.removeEventListener('visibilitychange', visibility));
        void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
            if (!alive.current) {
                return;
            }
            setRegistration(reg);
            setUpdate(reg.waiting);
            const observed = new Set<ServiceWorker>();
            const observeInstallation = () => {
                const installing = reg.installing;
                if (!installing || observed.has(installing)) {
                    return;
                }
                observed.add(installing);
                const stateChanged = () => {
                    if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                        setUpdate(reg.waiting);
                    }
                    if (installing.state === 'redundant' && !navigator.serviceWorker.controller) {
                        setOfflineText(de.offline.failed);
                    }
                };
                installing.addEventListener('statechange', stateChanged);
                cleanup.push(() => installing.removeEventListener('statechange', stateChanged));
                stateChanged();
            };
            reg.addEventListener('updatefound', observeInstallation);
            cleanup.push(() => reg.removeEventListener('updatefound', observeInstallation));
            observeInstallation();
            if (navigator.serviceWorker.controller) {
                void verify();
            } else {
                setOfflineText(de.offline.loading);
            }
        }).catch((error) => {
            if (alive.current) {
                setOfflineText(de.offline.registrationFailed(error));
            }
        });
        return cleanupAll;
    }, [verify, canReload]);

    async function checkStorage() {
        try {
            const persisted = await navigator.storage?.persist?.();
            const estimate = await navigator.storage?.estimate?.();
            if (alive.current) {
                setStorage(de.offline.storage(Boolean(persisted), estimate?.usage ?? 0));
            }
        } catch {
            if (alive.current) {
                setStorage(de.offline.storageFailed);
            }
        }
    }

    function applyUpdate() {
        if (update && canReload()) {
            reloadRequested.current = true;
            update.postMessage({ type: 'ACTIVATE' });
        }
    }

    return { online, offline, offlineText, registration, update, storage, verify, checkStorage, applyUpdate };
}
