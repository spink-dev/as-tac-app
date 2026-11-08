import pkg from '../package.json';

export interface BuildInfo {
    version: string;
    commit: string;
    /** ISO time of the build. */
    date: string;
}

// Set by Vite (`define` in vite.config.ts); absent in unit tests.
declare const __BUILD__: BuildInfo | undefined;

const build: BuildInfo = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { version: pkg.version, commit: '', date: '' };

export const APP_VERSION: string = build.version;
export const APP_NAME = 'AS-TAC';
export const BUILD: BuildInfo = build;

/** Two builds are the same app exactly when version, commit and build time match. */
export function sameBuild(a: BuildInfo, b: BuildInfo): boolean {
    return a.version === b.version && a.commit === b.commit && a.date === b.date;
}

export function isBuildInfo(value: unknown): value is BuildInfo {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const v = value as Record<string, unknown>;
    const text = (field: unknown, min: number) => typeof field === 'string' && field.length >= min && field.length < 64;
    return text(v.version, 1) && text(v.commit, 0) && text(v.date, 0);
}
