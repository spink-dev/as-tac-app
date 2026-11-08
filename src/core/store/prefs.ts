import { create } from 'zustand';

export type Appearance = 'day' | 'dark' | 'red';
export type Locale = 'de' | 'en';

export interface Prefs {
    appearance: Appearance;
    locale: Locale;
    bearingUnit: 'deg' | 'mil';
    coordFormat: 'mgrs' | 'latlng';
    onlineBackground: boolean;
    redMapFilter: boolean;
    keybinds: Record<string, string>;
    displayName: string;
    onboarded: boolean;
}

const KEY = 'as-tac.prefs';

function readStorage<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : null;
    } catch {
        return null;
    }
}

function systemAppearance(): Appearance {
    try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'day';
    } catch {
        return 'day';
    }
}

function initial(): Prefs {
    const stored = typeof localStorage === 'undefined' ? null : readStorage<Partial<Prefs>>(KEY);
    let appearance: Appearance = systemAppearance();
    try {
        const explicit = localStorage.getItem('as-tac.appearance');
        if (explicit === 'day' || explicit === 'dark' || explicit === 'red') {
            appearance = explicit;
        }
    } catch {
        // Storage may be blocked; the choice then lasts for this session only.
    }
    const language = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'de';
    return {
        appearance,
        locale: stored?.locale ?? language,
        bearingUnit: stored?.bearingUnit ?? 'deg',
        coordFormat: stored?.coordFormat ?? 'mgrs',
        onlineBackground: stored?.onlineBackground ?? true,
        redMapFilter: stored?.redMapFilter ?? true,
        keybinds: stored?.keybinds ?? {},
        displayName: stored?.displayName ?? '',
        onboarded: stored?.onboarded ?? false,
    };
}

interface PrefsState extends Prefs {
    set: (patch: Partial<Prefs>) => void;
}

export const usePrefs = create<PrefsState>((set, get) => ({
    ...initial(),
    set(patch) {
        set(patch);
        const { set: _ignored, ...rest } = { ...get(), ...patch };
        void _ignored;
        try {
            localStorage.setItem(KEY, JSON.stringify({ ...rest, appearance: undefined }));
            if (patch.appearance) {
                localStorage.setItem('as-tac.appearance', patch.appearance);
            }
        } catch {
            // Session-only preference when storage is unavailable.
        }
        if (patch.appearance && typeof document !== 'undefined') {
            document.documentElement.dataset.appearance = patch.appearance;
        }
        if (patch.locale && typeof document !== 'undefined') {
            document.documentElement.lang = patch.locale === 'en' ? 'en' : 'de-CH';
        }
    },
}));

if (typeof document !== 'undefined') {
    document.documentElement.lang = usePrefs.getState().locale === 'en' ? 'en' : 'de-CH';
}

export const APPEARANCE_ORDER: Appearance[] = ['day', 'dark', 'red'];
