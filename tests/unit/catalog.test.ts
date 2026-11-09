import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLED_AREAS, byCountry, countryName, defaultCountry, isBundled } from '../../src/core/areas/catalog';
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
            // New fields carry their country in id and folder; Mahlwinkel keeps its id and path.
            if (area.id !== 'mahlwinkel') {
                expect(area.id.startsWith(`${area.country.toLowerCase()}-`)).toBe(true);
                expect(area.file).toBe(`/maps/${area.country.toLowerCase()}/${area.id.slice(3)}.geojson`);
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

    it('opens on the chosen field’s country, then the browser region, then Germany', () => {
        expect(defaultCountry('fr-baerenkopf', ['de-CH'])).toBe('FR');
        expect(defaultCountry(null, ['de-CH', 'de'])).toBe('CH');
        expect(defaultCountry('my-own-area', ['en-US', 'en'])).toBe('DE');
        expect(defaultCountry(undefined, [])).toBe('DE');
    });
});
