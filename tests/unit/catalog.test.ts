import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLED_AREAS, byCountry, countryName, defaultCountry, homeCountry, isBundled, startField, ZONE_COUNTRY } from '../../src/core/areas/catalog';
import { areaKm2 } from '../../src/core/areas/overpass';
import { validateBounds } from '../../src/core/areas/store';

describe('field catalog', () => {
    it('has unique, well-formed entries', () => {
        const ids = BUNDLED_AREAS.map((area) => area.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const area of BUNDLED_AREAS) {
            expect(area.id).toMatch(/^[a-z0-9-]{1,60}$/);
            expect(area.country).toMatch(/^[A-Z]{2}$/);
            expect(area.name.length).toBeGreaterThan(1);
            expect(area.place.length).toBeGreaterThan(1);
            // Files are named after their content, so a refreshed field never replaces a file an
            // older app version still downloads. Mahlwinkel keeps its id and its pre-1.0 path.
            const country = area.country.toLowerCase();
            const name = area.id === 'mahlwinkel' ? area.id : area.id.slice(country.length + 1);
            if (area.id !== 'mahlwinkel') {
                expect(area.id.startsWith(`${country}-`)).toBe(true);
            }
            if (area.file !== '/maps/mahlwinkel.geojson') {
                expect(area.file).toBe(`/maps/${country}/${name}.${area.sha256.slice(0, 8)}.geojson`);
            }
            validateBounds(area.bounds);
            expect(areaKm2(area.bounds)).toBeLessThanOrEqual(36);
            expect(area.website ?? 'https://x').toMatch(/^https:\/\//);
            expect(area.osm ?? 'way/1').toMatch(/^(node|way|relation)\/\d+$/);
        }
    });

    it('ships exactly the files it describes', () => {
        for (const area of BUNDLED_AREAS) {
            const bytes = readFileSync(`public${area.file}`);
            expect(bytes.byteLength, area.id).toBe(area.bytes);
            expect(createHash('sha256').update(bytes).digest('hex'), area.id).toBe(area.sha256);
            const data = JSON.parse(bytes.toString('utf8')) as GeoJSON.FeatureCollection;
            expect(data.type).toBe('FeatureCollection');
            expect(data.features.length, area.id).toBe(area.featureCount);
            expect(area.dataTimestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
            // Every coordinate lies in the field's bounds (the box the data was fetched for, plus
            // the ways that cross its edge).
            const [w, s, e, n] = area.bounds;
            const points = data.features.filter((f) => f.geometry.type === 'Point').map((f) => (f.geometry as GeoJSON.Point).coordinates);
            for (const [lon, lat] of points) {
                expect(lon >= w - 0.02 && lon <= e + 0.02 && lat >= s - 0.02 && lat <= n + 0.02, area.id).toBe(true);
            }
        }
    });

    it('keeps the manifest that apps up to 1.0.0-alpha.2 read for Mahlwinkel', () => {
        const manifest = JSON.parse(readFileSync('public/maps/mahlwinkel.json', 'utf8')) as { sha256: string; byteSize: number };
        const bytes = readFileSync('public/maps/mahlwinkel.geojson');
        expect(bytes.byteLength).toBe(manifest.byteSize);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
        // Exactly the data those versions have compiled in: never regenerated.
        expect(manifest.sha256).toBe('c9a74fc7e9ca392be9b830f42239d53eb921e2e63c536c0db7e0ea3e62c3adc3');
    });

    it('no longer contains the Zürich test areas', () => {
        expect(isBundled('zurich')).toBe(false);
        expect(isBundled('benglen')).toBe(false);
        expect(isBundled('mahlwinkel')).toBe(true);
        expect(isBundled('fr-baerenkopf')).toBe(true);
    });

    it('groups by country, alphabetical in the display language', () => {
        const de = byCountry(BUNDLED_AREAS, 'de');
        expect(de.reduce((sum, group) => sum + group.areas.length, 0)).toBe(BUNDLED_AREAS.length);
        expect(de.map((group) => group.name)).toEqual([...de.map((group) => group.name)].sort((a, b) => a.localeCompare(b, 'de-CH')));
        expect(de.find((group) => group.country === 'CH')?.name).toBe('Schweiz');
        expect(byCountry(BUNDLED_AREAS, 'en').find((group) => group.country === 'CH')?.name).toBe('Switzerland');
        for (const group of de) {
            expect(group.areas.every((area) => area.country === group.country)).toBe(true);
        }
    });

    it('names countries and falls back to the code', () => {
        expect(countryName('FR', 'de')).toBe('Frankreich');
        expect(countryName('GB', 'en')).toBe('United Kingdom');
        expect(countryName('not a code', 'de')).toBe('not a code');
    });

    it('no longer contains Riedikon', () => {
        expect(isBundled('ch-riedikon')).toBe(false);
        expect(BUNDLED_AREAS.filter((area) => area.country === 'CH').map((area) => area.id)).toEqual(['ch-steinmaur']);
    });

    it('opens on the chosen field’s country, then the user’s country, then Germany', () => {
        const at = (timeZone: string, ...languages: string[]) => ({ timeZone, languages });
        // The chosen field wins.
        expect(defaultCountry('fr-baerenkopf', at('Europe/Zurich', 'de-CH'))).toBe('FR');
        // The device's time zone names the country.
        expect(defaultCountry(null, at('Europe/Zurich', 'en-US'))).toBe('CH');
        expect(defaultCountry(null, at('Europe/Rome', 'de-CH'))).toBe('IT');
        expect(defaultCountry(null, at('Europe/Busingen', 'de-CH'))).toBe('DE');
        expect(defaultCountry(null, at('Atlantic/Canary', 'es-ES'))).toBe('ES');
        expect(defaultCountry(null, at('Europe/Berlin', 'de-CH'))).toBe('DE');
        // A country without fields: Germany, whatever the languages say.
        expect(defaultCountry(null, at('America/New_York', 'de-CH'))).toBe('DE');
        expect(defaultCountry(null, at('Europe/Vaduz', 'de-CH'))).toBe('DE');
        expect(defaultCountry(null, at('Europe/Prague', 'fr-FR'))).toBe('DE');
        // A zone without a place (UTC, CET): the first browser region that has fields.
        expect(defaultCountry(null, at('UTC', 'en-US', 'de-CH'))).toBe('CH');
        expect(defaultCountry(null, at('Etc/GMT-1', 'fr-BE'))).toBe('BE');
        expect(defaultCountry(null, at('', 'zh-Hant-TW', 'it-IT'))).toBe('IT');
        expect(defaultCountry('my-own-area', at('UTC', 'en-US', 'en'))).toBe('DE');
        expect(defaultCountry(undefined, at('', 'not a language'))).toBe('DE');
        expect(homeCountry(at('Asia/Tokyo', 'de-CH'))).toBeNull();
        // Inherited object keys are not time zones.
        expect(homeCountry(at('constructor', 'de-AT'))).toBe('AT');
    });

    it('knows the time zones of every catalogue country', () => {
        const countries = new Set(BUNDLED_AREAS.map((area) => area.country));
        expect(new Set(ZONE_COUNTRY.values())).toEqual(countries);
        // IANA's own list, where the system has one: every zone of a catalogue country is in the table.
        const tab = '/usr/share/zoneinfo/zone.tab';
        if (existsSync(tab)) {
            const zones = readFileSync(tab, 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split('\t'));
            for (const [code, , zone] of zones) {
                if (countries.has(code)) {
                    expect([zone, ZONE_COUNTRY.get(zone)]).toEqual([zone, code]);
                }
            }
        }
    });

    it('starts a new plan on Mahlwinkel in Germany, elsewhere on the first field by name', () => {
        expect(startField('DE')?.id).toBe('mahlwinkel');
        expect(startField('CH')?.id).toBe('ch-steinmaur');
        const fr = byCountry(BUNDLED_AREAS, 'de').find((group) => group.country === 'FR');
        expect(startField('FR')?.id).toBe(fr?.areas[0].id);
        expect(startField('US')).toBeUndefined();
    });
});
