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
            resolve({ ready: false, error: 'Noch nicht von der Offline-App kontrolliert.' });
            return;
        }
        const channel = new MessageChannel();
        const timeout = window.setTimeout(() => {
            channel.port1.close();
            resolve({ ready: false, error: 'Offline-Prüfung hat zu lange gedauert.' });
        }, 15000);
        channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            channel.port1.close();
            resolve(event.data);
        };
        worker.postMessage({ type: repair ? 'REPAIR' : 'VERIFY' }, [channel.port2]);
    });
}
