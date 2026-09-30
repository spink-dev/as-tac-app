import { de } from '../i18n/de';
export interface OfflineStatus {
    ready: boolean;
    version?: string;
    bytes?: number;
    error?: string;
}

export function verifyOffline(repair = false): Promise<OfflineStatus> {
    return new Promise((resolve) => {
        const worker = navigator.serviceWorker?.controller;
        if (!worker) {
            resolve({ ready: false, error: de.offline.uncontrolled });
            return;
        }
        const channel = new MessageChannel();
        const timeout = window.setTimeout(() => {
            channel.port1.close();
            resolve({ ready: false, error: de.offline.timeout });
        }, 15000);
        channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            channel.port1.close();
            resolve(event.data);
        };
        worker.postMessage({ type: repair ? 'REPAIR' : 'VERIFY' }, [channel.port2]);
    });
}
