import { describe, expect, it } from 'vitest';
import { S } from '../../src/i18n/strings';
import { migratePrefs, PREFS_VERSION } from '../../src/core/store/prefs';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('string table', () => {
    const entries = Object.entries(S) as [string, readonly [string, string]][];

    it('has German and English for every key', () => {
        const missing = entries.filter(([, pair]) => pair.length !== 2 || !pair[0].trim() || !pair[1].trim()).map(([key]) => key);
        expect(missing).toEqual([]);
    });

    it('uses Swiss spelling (no ß) in German', () => {
        expect(entries.filter(([, [de]]) => de.includes('ß')).map(([key]) => key)).toEqual([]);
    });

    it('has the same placeholders in both languages', () => {
        const differing = entries.filter(([, [de, en]]) => placeholders(de).join() !== placeholders(en).join()).map(([key]) => key);
        expect(differing).toEqual([]);
    });
});

describe('preferences migration', () => {
    it('starts in German without stored preferences, whatever the browser says', () => {
        expect(migratePrefs(null, 'en-US').prefs.locale).toBeUndefined();
        expect(migratePrefs(null, 'en-US').version).toBe(PREFS_VERSION);
    });

    it('resets an English that alpha.1 took over from an English browser', () => {
        const { prefs, changed } = migratePrefs({ locale: 'en', bearingUnit: 'mil' }, 'en-GB');
        expect(prefs.locale).toBe('de');
        expect(prefs.bearingUnit).toBe('mil');
        expect(changed).toBe(true);
    });

    it('keeps an English chosen by hand on a German browser', () => {
        expect(migratePrefs({ locale: 'en' }, 'de-CH').prefs.locale).toBe('en');
    });

    it('leaves current preferences alone, including a later English choice', () => {
        const { prefs, changed } = migratePrefs({ v: PREFS_VERSION, locale: 'en' }, 'en-US');
        expect(prefs.locale).toBe('en');
        expect(changed).toBe(false);
    });

    it('does not touch preferences written by a newer app', () => {
        const newer = { v: PREFS_VERSION + 3, locale: 'en', futureField: 42 };
        const { prefs, version, changed } = migratePrefs(newer, 'en-US');
        expect(prefs).toEqual(newer);
        expect(version).toBe(PREFS_VERSION + 3);
        expect(changed).toBe(false);
    });

    it('survives garbage', () => {
        expect(migratePrefs('nonsense', 'de').prefs).toEqual({ v: PREFS_VERSION });
        expect(migratePrefs([1, 2], 'de').prefs).toEqual({ v: PREFS_VERSION });
        expect(migratePrefs({ v: 'x', locale: 'en' }, 'en').prefs.locale).toBe('de');
    });
});
