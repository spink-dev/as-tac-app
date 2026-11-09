import catalog from '../../config/maps.json';
import type { Bounds } from '../geo/geo';
import type { BundledArea } from './types';

/**
 * Prepared airsoft fields that ship with the app, by country (ISO 3166-1 alpha-2). Each basemap
 * is OpenStreetMap data at `file` (public/maps/<country>/…), copied into IndexedDB on first use;
 * only Mahlwinkel is precached. `npm run map:build` (scripts/build-maps.mjs) refreshes the files
 * and writes size, feature count and SHA-256 back into src/config/maps.json — the install checks
 * the download against that hash. Removing a field from the catalog never touches a copy already
 * installed on a device: it then counts as one of the device's own areas.
 */
export const BUNDLED_AREAS: readonly BundledArea[] = (catalog.fields as (Omit<BundledArea, 'bounds'> & { bounds: number[] })[]).map((field) => ({
    ...field,
    bounds: field.bounds as Bounds,
}));

export function bundledArea(id: string | null | undefined): BundledArea | undefined {
    return id ? BUNDLED_AREAS.find((area) => area.id === id) : undefined;
}

export function isBundled(id: string | null | undefined): boolean {
    return Boolean(bundledArea(id));
}

export interface CountryGroup {
    country: string;
    name: string;
    areas: BundledArea[];
}

const names = new Map<string, Intl.DisplayNames | null>();

/** «Schweiz» / "Switzerland"; the code itself where the browser has no names. */
export function countryName(code: string, locale: 'de' | 'en'): string {
    if (!names.has(locale)) {
        try {
            names.set(locale, new Intl.DisplayNames([locale === 'de' ? 'de-CH' : 'en'], { type: 'region' }));
        } catch {
            names.set(locale, null);
        }
    }
    try {
        return names.get(locale)?.of(code) ?? code;
    } catch {
        return code;
    }
}

/** Fields by country, countries and fields alphabetical in the display language. */
export function byCountry(areas: readonly BundledArea[], locale: 'de' | 'en'): CountryGroup[] {
    const collator = new Intl.Collator(locale === 'de' ? 'de-CH' : 'en');
    const groups = new Map<string, BundledArea[]>();
    for (const area of areas) {
        groups.set(area.country, [...(groups.get(area.country) ?? []), area]);
    }
    return [...groups.entries()]
        .map(([country, list]) => ({ country, name: countryName(country, locale), areas: list.sort((a, b) => collator.compare(a.name, b.name)) }))
        .sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * The country a catalogue opens on: that of the chosen field, else the first region among the
 * browser's languages that has fields (de-CH → CH), else Germany.
 */
export function defaultCountry(areaId?: string | null, languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? []): string {
    const chosen = bundledArea(areaId);
    if (chosen) {
        return chosen.country;
    }
    for (const language of languages) {
        const region = language.split('-')[1]?.toUpperCase();
        if (region && BUNDLED_AREAS.some((area) => area.country === region)) {
            return region;
        }
    }
    return 'DE';
}
