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
 * Time zones of the catalogue's countries: every zone IANA's zone.tab gives them, plus the old
 * names a browser may still report (tests/unit/catalog.test.ts checks the table against zone.tab
 * and the catalogue). A field in a new country needs its zones here.
 */
export const ZONE_COUNTRY: ReadonlyMap<string, string> = new Map(Object.entries({
    'Europe/Vienna': 'AT',
    'Europe/Brussels': 'BE',
    'Europe/Sofia': 'BG',
    'Europe/Zurich': 'CH',
    'Europe/Berlin': 'DE',
    'Europe/Busingen': 'DE',
    'Europe/Madrid': 'ES',
    'Africa/Ceuta': 'ES',
    'Atlantic/Canary': 'ES',
    'Europe/Paris': 'FR',
    'Europe/London': 'GB',
    'Europe/Belfast': 'GB',
    GB: 'GB',
    'GB-Eire': 'GB',
    'Europe/Budapest': 'HU',
    'Europe/Rome': 'IT',
    'Europe/Amsterdam': 'NL',
    'Europe/Warsaw': 'PL',
    Poland: 'PL',
    'Europe/Bratislava': 'SK',
}));

/** Zones that name a place; UTC, Etc/GMT+1, CET and the like say nothing about where the device is. */
const PLACED_ZONE = /^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Brazil|Canada|Chile|Mexico|US)\//;

export interface DevicePlace {
    timeZone: string;
    languages: readonly string[];
}

/** What the device says about where it is, without asking any server. */
export function devicePlace(): DevicePlace {
    let timeZone = '';
    try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
        // No time zone support: the languages alone decide.
    }
    return { timeZone, languages: typeof navigator === 'undefined' ? [] : navigator.languages ?? [] };
}

/**
 * The user's country where the catalogue has fields there, else `null`. The device's time zone
 * decides (Europe/Zurich → CH; Europe/Rome → IT; America/New_York → no fields there). Only where the
 * zone names no place (UTC) the first region among the browser's languages that has fields counts
 * (de-CH → CH). Nothing leaves the device: no location request, no IP lookup.
 */
export function homeCountry(place: DevicePlace = devicePlace()): string | null {
    const hasFields = (country: string) => BUNDLED_AREAS.some((area) => area.country === country);
    const zone = ZONE_COUNTRY.get(place.timeZone);
    if (zone !== undefined || PLACED_ZONE.test(place.timeZone)) {
        return zone !== undefined && hasFields(zone) ? zone : null;
    }
    for (const language of place.languages) {
        const region = languageRegion(language);
        if (region && hasFields(region)) {
            return region;
        }
    }
    return null;
}

/** de-CH → CH, zh-Hant-TW → TW; a language without a region (de) names no country. */
function languageRegion(language: string): string | undefined {
    try {
        return new Intl.Locale(language).region;
    } catch {
        return undefined;
    }
}

/** The country a catalogue opens on: that of the chosen field, else the user's, else Germany. */
export function defaultCountry(areaId?: string | null, place: DevicePlace = devicePlace()): string {
    return bundledArea(areaId)?.country ?? homeCountry(place) ?? 'DE';
}

/** Germany's start field: it ships with the app (works offline at once) and has event templates. */
export const START_FIELD = 'mahlwinkel';

/** The field a new plan starts on in a country: Mahlwinkel in Germany, elsewhere the first by name. */
export function startField(country: string, locale: 'de' | 'en' = 'de'): BundledArea | undefined {
    const fields = BUNDLED_AREAS.filter((area) => area.country === country);
    return fields.find((area) => area.id === START_FIELD) ?? byCountry(fields, locale)[0]?.areas[0];
}
