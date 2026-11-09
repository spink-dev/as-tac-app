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

/** Zones that name a place; UTC, Etc/GMT+1 and the like say nothing about where the device is. */
const PLACED_ZONE = /^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Brazil|Canada|Chile|Mexico|US)\//;

/**
 * Zones that also stand for an abbreviation: since tzdata 2024b `CET` and `MET` are Europe/Brussels,
 * `EET` is Europe/Athens and `WET` Europe/Lisbon, and browsers report those names. A German device
 * set to `CET` must not open on Belgium, so here the languages come first.
 */
const SHARED_ZONES: ReadonlySet<string> = new Set(['Europe/Brussels', 'Europe/Athens', 'Europe/Lisbon']);

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
 * decides (Europe/Zurich → CH; Europe/Rome → IT; America/New_York → no fields there). Where the zone
 * names no place (UTC) or may be an abbreviation (Europe/Brussels = CET), the first region among the
 * browser's languages that has fields counts (de-CH → CH); Europe/Brussels without one stays Belgium.
 * Nothing leaves the device: no location request, no IP lookup.
 */
export function homeCountry(place: DevicePlace = devicePlace()): string | null {
    const zone = ZONE_COUNTRY.get(place.timeZone);
    const spoken = place.languages.map(languageRegion).find((region) => region !== undefined && hasFields(region)) ?? null;
    if (SHARED_ZONES.has(place.timeZone) && spoken) {
        return spoken;
    }
    if (zone !== undefined || PLACED_ZONE.test(place.timeZone)) {
        return zone !== undefined && hasFields(zone) ? zone : null;
    }
    return spoken;
}

function hasFields(country: string): boolean {
    return BUNDLED_AREAS.some((area) => area.country === country);
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

/** Germany's start field: it ships with the app (on every device, also offline) and has event templates. */
export const START_FIELD = 'mahlwinkel';

/**
 * The field a new plan starts on in a country: one already on the device (Mahlwinkel always is), in
 * the order Mahlwinkel, then by name; without one the first in that order.
 */
export function startField(country: string, locale: 'de' | 'en' = 'de', installed: ReadonlySet<string> = new Set()): BundledArea | undefined {
    const fields = BUNDLED_AREAS.filter((area) => area.country === country);
    const ordered = [...fields.filter((area) => area.id === START_FIELD), ...(byCountry(fields.filter((area) => area.id !== START_FIELD), locale)[0]?.areas ?? [])];
    return ordered.find((area) => area.id === START_FIELD || installed.has(area.id)) ?? ordered[0];
}

/**
 * Country and field a new plan starts on. Offline, a field that is not on the device cannot be
 * used: with nothing of that country on the device, Mahlwinkel in Germany (it ships with the app).
 */
export function startChoice(country: string, locale: 'de' | 'en', installed: ReadonlySet<string>, online: boolean): { country: string; areaId: string } {
    const field = startField(country, locale, installed);
    if (field && (online || field.id === START_FIELD || installed.has(field.id))) {
        return { country, areaId: field.id };
    }
    return { country: bundledArea(START_FIELD)?.country ?? 'DE', areaId: START_FIELD };
}
