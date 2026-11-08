import { usePrefs } from './store/prefs';

/** The parts of the Network Information API we use (Chrome/Android; absent on iOS/Firefox). */
interface NetworkInformation {
    type?: string;
    effectiveType?: string;
    saveData?: boolean;
}

export function connectionInfo(): NetworkInformation | undefined {
    return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

/**
 * Whether large pictures (image maps, logos) may be downloaded without asking. «Nur WLAN» needs
 * a device that reports its connection type (Android, ChromeOS); everywhere else (iPhone,
 * desktop browsers) it acts like «Manuell».
 * In «Automatisch», the browser's data-saver signal is respected.
 */
export function mayAutoDownload(): boolean {
    const mode = usePrefs.getState().mediaDownload;
    const info = connectionInfo();
    if (mode === 'manual') {
        return false;
    }
    if (mode === 'wifi') {
        return info?.type === 'wifi' || info?.type === 'ethernet';
    }
    return !info?.saveData;
}
