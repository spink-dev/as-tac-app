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
    /** When image maps and logos from live partners are downloaded (mobile data). */
    mediaDownload: 'auto' | 'wifi' | 'manual';
}

const KEY = 'as-tac.prefs';

/** Version of the stored preferences. Unversioned records are version 1 (1.0.0-alpha.1). */
export const PREFS_VERSION = 2;

type Stored = Record<string, unknown>;

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

/**
 * Bring stored preferences up to `PREFS_VERSION`, one step per version. Pure (no storage access).
 *
 * 1 → 2: German is the first language. 1.0.0-alpha.1 stored the browser language as if it had
 * been chosen, so English is kept only where the browser is not English (then it was picked by hand).
 *
 * A record from a newer app (version above ours) is left as it is: its known fields still apply and
 * the unknown ones are kept on the next write, so returning to the newer version loses nothing.
 */
export function migratePrefs(input: unknown, browserLanguage: string): { prefs: Stored; version: number; changed: boolean } {
    const prefs: Stored = input && typeof input === 'object' && !Array.isArray(input) ? { ...(input as Stored) } : {};
    const start = typeof prefs.v === 'number' && Number.isInteger(prefs.v) && prefs.v >= 1 ? prefs.v : 1;
    let version = start;
    if (version < 2) {
        if (prefs.locale === 'en' && browserLanguage.toLowerCase().startsWith('en')) {
            prefs.locale = 'de';
        }
        version = 2;
    }
    prefs.v = version;
    return { prefs, version, changed: version !== start };
}

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

function keybindsOf(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return Object.fromEntries(Object.entries(value as Stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/**
 * Known preferences from a stored (already migrated) record; anything missing or malformed takes
 * its default, and German is the default language. `rejected` lists the known fields whose stored
 * value was not usable, and `foreign` the fields this version does not know. Pure.
 */
export function normalizePrefs(stored: Stored, appearance: Appearance): { prefs: Prefs; rejected: Stored; foreign: Stored } {
    const prefs: Prefs = {
        appearance,
        // German first, whatever the browser says; English only when chosen.
        locale: oneOf(stored.locale, ['de', 'en'] as const, 'de'),
        bearingUnit: oneOf(stored.bearingUnit, ['deg', 'mil'] as const, 'deg'),
        coordFormat: oneOf(stored.coordFormat, ['mgrs', 'latlng'] as const, 'mgrs'),
        onlineBackground: bool(stored.onlineBackground, true),
        redMapFilter: bool(stored.redMapFilter, true),
        keybinds: keybindsOf(stored.keybinds),
        displayName: typeof stored.displayName === 'string' ? stored.displayName.slice(0, 40) : '',
        onboarded: bool(stored.onboarded, false),
        mediaDownload: oneOf(stored.mediaDownload, ['auto', 'wifi', 'manual'] as const, 'auto'),
    };
    const known = new Set<string>([...Object.keys(prefs), 'v']);
    const foreign = Object.fromEntries(Object.entries(stored).filter(([key]) => !known.has(key)));
    const rejected = Object.fromEntries(Object.entries(stored).filter(([key, value]) => known.has(key) && key !== 'v' && key !== 'appearance'
        && JSON.stringify(value) !== JSON.stringify(prefs[key as keyof Prefs])));
    return { prefs, rejected, foreign };
}

/**
 * The record to store. A record from a newer app (`version` above ours) keeps what this version
 * could not read: unknown fields, and the stored value of known fields this version rejected —
 * until the user changes that preference here. `appearance` lives under its own key.
 */
export function storedRecord(prefs: Prefs, keep: { foreign: Stored; preserved: Stored; version: number }): Stored {
    return { ...keep.foreign, ...prefs, ...keep.preserved, appearance: undefined, v: keep.version };
}

const keep: { foreign: Stored; preserved: Stored; version: number } = { foreign: {}, preserved: {}, version: PREFS_VERSION };

function initial(): Prefs {
    const browser = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
    const raw = typeof localStorage === 'undefined' ? null : readStorage<unknown>(KEY);
    const { prefs: stored, version, changed } = migratePrefs(raw, browser);
    let appearance: Appearance = systemAppearance();
    try {
        const explicit = localStorage.getItem('as-tac.appearance');
        if (explicit === 'day' || explicit === 'dark' || explicit === 'red') {
            appearance = explicit;
        }
    } catch {
        // Storage may be blocked; the choice then lasts for this session only.
    }
    const { prefs, rejected, foreign } = normalizePrefs(stored, appearance);
    keep.version = Math.max(version, PREFS_VERSION);
    keep.foreign = foreign;
    keep.preserved = version > PREFS_VERSION ? rejected : {};
    if (raw && changed) {
        write(prefs);
    }
    return prefs;
}

function write(prefs: Prefs) {
    try {
        localStorage.setItem(KEY, JSON.stringify(storedRecord(prefs, keep)));
    } catch {
        // Session-only preference when storage is unavailable.
    }
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
        // A preference changed here replaces whatever a newer app had stored for it.
        keep.preserved = Object.fromEntries(Object.entries(keep.preserved).filter(([key]) => !(key in patch)));
        write(rest);
        try {
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
