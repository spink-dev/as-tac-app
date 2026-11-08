import { create } from 'zustand';

interface PwaState {
    offlineReady: boolean;
    needRefresh: boolean;
    update: () => void;
}

export const usePwa = create<PwaState>(() => ({
    offlineReady: false,
    needRefresh: false,
    update: () => window.location.reload(),
}));

/** Register the service worker (production builds only). Updates activate on explicit request. */
export async function registerPwa() {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) {
        return;
    }
    const { registerSW } = await import('virtual:pwa-register');
    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            usePwa.setState({ needRefresh: true });
        },
        onOfflineReady() {
            usePwa.setState({ offlineReady: true });
        },
        onRegisteredSW(_url, registration) {
            if (registration?.active) {
                usePwa.setState({ offlineReady: true });
            }
        },
    });
    usePwa.setState({ update: () => void updateSW(true) });
}
