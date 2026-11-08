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

/**
 * Order of two versions like `1.0.0-alpha.2` (semver: numbers first, a pre-release before the
 * release, pre-release parts compared numerically where both are numbers). Negative when a < b.
 */
export function compareVersions(a: string, b: string): number {
    const split = (v: string) => {
        const [core, pre] = v.split('+')[0].split(/-(.*)/s);
        return { core: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] };
    };
    const x = split(a);
    const y = split(b);
    for (let i = 0; i < 3; i++) {
        const diff = (x.core[i] ?? 0) - (y.core[i] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    if (x.pre.length === 0 || y.pre.length === 0) {
        return (x.pre.length === 0 ? 1 : 0) - (y.pre.length === 0 ? 1 : 0);
    }
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        const p = x.pre[i];
        const q = y.pre[i];
        if (p === undefined || q === undefined) {
            return p === undefined ? -1 : 1;
        }
        const numeric = /^\d+$/.test(p) && /^\d+$/.test(q);
        const diff = numeric ? Number(p) - Number(q) : p.localeCompare(q);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}
