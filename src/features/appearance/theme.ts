import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'red';
export const themeLabels = { light: 'Tag', dark: 'Dunkel', red: 'Rotlicht' };
export const themeColors = {
    light: '#f4f5f6',
    dark: '#171a1e',
    red: '#100505',
};
const key = 'as-tac.appearance';
function current(): Theme {
    const value = document.documentElement.dataset.theme;
    return value === 'dark' || value === 'red' ? value : 'light';
}
export function setTheme(theme: Theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
    try {
        localStorage.setItem(key, theme);
    } catch {
        // Private/storage-restricted browsers still support changing this session's appearance.
    }
    window.dispatchEvent(new Event('as-tac:appearance'));
}
function subscribe(notify: () => void) {
    window.addEventListener('as-tac:appearance', notify);
    const sync = (event: StorageEvent) => {
        if (event.key === key && ['light', 'dark', 'red'].includes(event.newValue ?? '')) {
            document.documentElement.dataset.theme = event.newValue!;
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[event.newValue as Theme]);
            notify();
        }
    };
    window.addEventListener('storage', sync);
    return () => {
        window.removeEventListener('as-tac:appearance', notify);
        window.removeEventListener('storage', sync);
    };
}
export function useTheme() {
    return useSyncExternalStore(subscribe, current, () => 'light' as Theme);
}
