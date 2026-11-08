import { describe, expect, it } from 'vitest';
import { areaKm2, overpassQuery, slugId, toBasemap } from '../../src/core/areas/overpass';
import { verifyArea } from '../../src/core/areas/store';
import { sha256Hex } from '../../src/core/storage/assets';
import { convertOldProject, isOldProject } from '../../src/core/legacy/astac';
import { ProjectSchema } from '../../src/core/model/schema';
import { buildMahlwinkelProject, MAHLWINKEL_EVENTS } from '../../src/core/templates/mahlwinkel';
import { knownImage, KNOWN_IMAGES } from '../../src/core/templates/knownImages';
import { fitControlPoints } from '../../src/core/geo/affine';

const overpass = {
    osm3s: { timestamp_osm_base: '2026-11-01T00:00:00Z' },
    elements: [
        { type: 'node', id: 1, lat: 52.38, lon: 11.82 },
        { type: 'node', id: 2, lat: 52.381, lon: 11.821 },
        { type: 'node', id: 3, lat: 52.381, lon: 11.82 },
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'track', name: 'Waldweg', 'addr:street': 'drop me', phone: '123' } },
        { type: 'way', id: 11, nodes: [1, 2, 3, 1], tags: { building: 'yes' } },
        { type: 'node', id: 4, lat: 52.3805, lon: 11.8205, tags: { power: 'generator' } },
        { type: 'way', id: 12, nodes: [1, 3], tags: { created_by: 'x' } },
    ],
};

describe('OSM area download', () => {
    it('builds a bbox query in south,west,north,east order', () => {
        const query = overpassQuery([11.81, 52.37, 11.84, 52.39]);
        expect(query).toContain('way[highway](52.370000,11.810000,52.390000,11.840000)');
        expect(query.startsWith('[out:json]')).toBe(true);
    });

    it('converts to a compact basemap and drops personal/irrelevant tags', () => {
        const fc = toBasemap(overpass);
        const track = fc.features.find((f) => f.properties?.highway === 'track');
        expect(track?.geometry.type).toBe('LineString');
        expect(track?.properties).toEqual({ highway: 'track', name: 'Waldweg' });
        expect(fc.features.some((f) => f.geometry.type === 'Polygon' && f.properties?.building === 'yes')).toBe(true);
        expect(fc.features.some((f) => f.properties?.power === 'generator')).toBe(true);
        expect(fc.features.every((f) => Object.keys(f.properties ?? {}).length > 0)).toBe(true);
    });

    it('rejects incomplete Overpass answers', () => {
        expect(() => toBasemap({ elements: [], remark: 'runtime error: Query timed out' })).toThrow('overpass-incomplete');
    });

    it('verifies area packages by hash', async () => {
        const data = toBasemap(overpass);
        const sha256 = await sha256Hex(JSON.stringify(data));
        const pkg = {
            format: 'as-tac-map', formatVersion: 1, id: 'test', name: 'Test', bounds: [11.8, 52.37, 11.84, 52.39], dataTimestamp: 'x', source: 'x',
            attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0', byteSize: 1, sha256, data,
        };
        await expect(verifyArea(pkg)).resolves.toBeTruthy();
        await expect(verifyArea({ ...pkg, sha256: '0'.repeat(64) })).rejects.toThrow('area-checksum');
        await expect(verifyArea({ ...pkg, bounds: [1, 1, 0, 0] })).rejects.toThrow('bounds');
    });

    it('measures areas and slugifies names', () => {
        expect(areaKm2([8.5, 47.35, 8.55, 47.39])).toBeGreaterThan(15);
        expect(slugId('Zürich Höngg Wald!')).toMatch(/^zurich-hongg-wald-[a-z0-9]+$/);
    });
});

describe('templates and known event maps', () => {
    it('builds schema-valid projects for all six Mahlwinkel events with lng/lat order', () => {
        expect(MAHLWINKEL_EVENTS).toHaveLength(6);
        for (const event of MAHLWINKEL_EVENTS) {
            const project = buildMahlwinkelProject(event.id);
            expect(ProjectSchema.safeParse(project).success).toBe(true);
            for (const element of project.elements) {
                if (element.kind === 'marker') {
                    expect(element.pos[0]).toBeGreaterThan(11.7);
                    expect(element.pos[0]).toBeLessThan(11.9);
                    expect(element.pos[1]).toBeGreaterThan(52.3);
                }
            }
        }
        const de = buildMahlwinkelProject('de');
        expect(de.event?.edition).toContain('r2');
        expect(de.elements.filter((e) => e.kind === 'zone' && e.category === 'safe')).toHaveLength(5);
    });

    it('recognises the two event images and fits them within a few metres', () => {
        for (const [hash, entry] of Object.entries(KNOWN_IMAGES)) {
            expect(knownImage(hash, entry.width, entry.height)).toBe(entry);
            expect(knownImage(hash, entry.width + 1, entry.height)).toBeNull();
            const fit = fitControlPoints(entry.controlPoints);
            expect(fit.rmsM).toBeLessThan(6);
            expect(Math.abs(fit.rotationDeg)).toBeLessThan(2);
        }
    });
});

describe('as-tac 0.x conversion', () => {
    const old = {
        id: '6b1f4c2e-1111-4a2b-8c3d-000000000001', schemaVersion: 2, name: 'Alter Plan', mapPackageId: 'zurich',
        workspace: { layers: [{ id: 'l1', name: 'Event', opacity: 0.8, locked: true }], siteId: 'zurich', eventId: 'test', edition: 'e1', source: 'manual' },
        teams: [{ id: 't1', name: 'Blau', shortLabel: 'B', colour: '#2244aa' }],
        phases: [
            { id: 'p1', order: 2, title: 'Angriff', notes: '', camera: { center: [8.54, 47.37], zoom: 15, bearing: 0, pitch: 0 }, visibleElementIds: ['e1'] },
            { id: 'p0', order: 1, title: 'Bereitstellung', notes: '', camera: null, visibleElementIds: ['e1', 'e2'] },
        ],
        elements: [
            { id: 'e1', projectId: 'x', type: 'point', geometry: { type: 'Point', coordinates: [8.54, 47.37] }, label: 'HQ', notes: '', layerId: 'l1', teamId: 't1', phaseIds: [], style: { colour: '#aa0000', width: 2, opacity: 1, symbol: 'flag' }, version: 1 },
            { id: 'e2', projectId: 'x', type: 'polygon', geometry: { type: 'Polygon', coordinates: [[[8.5, 47.3], [8.6, 47.3], [8.6, 47.4], [8.5, 47.3]]] }, label: 'Safe Zone', notes: '', phaseIds: [], style: { colour: '#e8c24d', width: 2, opacity: 1, pattern: 'hatch' }, version: 1 },
            { id: 'e3', projectId: 'x', type: 'circle', geometry: { type: 'Circle', center: [8.55, 47.36], radiusMeters: 120 }, label: '', notes: '', phaseIds: [], style: { colour: '#00aa00', width: 2, opacity: 1 }, version: 1 },
            { id: 'e4', projectId: 'x', type: 'freehand', geometry: { type: 'LineString', coordinates: [[8.5, 47.3], [8.51, 47.31]] }, label: '', notes: '', phaseIds: [], style: { colour: '#000000', width: 3, opacity: 1 }, version: 1 },
            { id: 'e5', projectId: 'x', type: 'line', geometry: { type: 'LineString', coordinates: [[999, 47.3], [8.51, 47.31]] }, label: '', notes: '', phaseIds: [], style: { colour: '#000000', width: 3, opacity: 1 }, version: 1, deletedAt: '2026-01-01' },
        ],
    };

    it('converts layers, teams, phases and every geometry type', () => {
        expect(isOldProject(old)).toBe(true);
        const project = convertOldProject(old as never, 'zurich');
        expect(ProjectSchema.safeParse(project).success).toBe(true);
        expect(project.phases.map((p) => p.name)).toEqual(['Bereitstellung', 'Angriff']);
        const hq = project.elements.find((e) => e.id === 'e1');
        expect(hq).toMatchObject({ kind: 'marker', type: 'hq', teamId: 't1', layerId: 'l1', phaseIds: undefined });
        const safe = project.elements.find((e) => e.id === 'e2');
        expect(safe).toMatchObject({ kind: 'zone', category: 'safe', pattern: 'hatch' });
        expect(safe?.kind === 'zone' && safe.shape.type === 'polygon' ? safe.shape.points.length : 0).toBe(3);
        expect(project.elements.find((e) => e.id === 'e3')).toMatchObject({ shape: { type: 'circle', radiusM: 120 } });
        expect(project.drawings).toHaveLength(1);
        expect(project.elements.some((e) => e.id === 'e5')).toBe(false);
        expect(project.teams[0]).toMatchObject({ name: 'Blau', unitNumber: 'B', color: '#2244aa' });
    });
});
