import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { createProject } from '../../src/core/model/factory';
import type { Project } from '../../src/core/model/schema';
import { assetUrl, getAsset, isRenderableImage, putAsset, putVerifiedAsset, sha256Hex } from '../../src/core/storage/assets';
import { exportAstac, readImportFile } from '../../src/core/files/astac';
import { readZip } from '../../src/core/files/zip';
import { decodePlanLink, encodePlanLink } from '../../src/core/files/link';
import { distanceM } from '../../src/core/geo/geo';
import { placeImage } from '../../src/core/geo/affine';

const nowhere = async () => {
    throw new Error('placement should not be asked');
};

function png(): Uint8Array {
    // Valid header is enough for the asset store (no decode in these paths).
    const bytes = new Uint8Array(64);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return bytes;
}

describe('.astac archive', () => {
    it('round-trips a plan with an image map and verifies every file', async () => {
        const asset = await putAsset(new Blob([new Uint8Array(png())], { type: 'image/png' }), 'scan.png');
        const project = createProject({ name: 'Roundtrip', areaId: null });
        project.images.push({ id: 'img1', name: 'Scan', asset: asset.hash, mime: 'image/png', width: 100, height: 80, corners: placeImage([8.54, 47.37], 100, 80, 1), opacity: 0.8, visible: true });
        project.elements.push({ kind: 'marker', id: 'm1', pos: [8.54, 47.37], type: 'objective', label: 'Alpha', anchorImageId: 'img1' });
        const { blob } = await exportAstac(project, { includeArea: false });
        const result = await readImportFile(blob, nowhere);
        expect(result.kind).toBe('project');
        if (result.kind === 'project') {
            expect(result.project.elements[0]).toEqual(project.elements[0]);
            expect(result.project.images[0].asset).toBe(asset.hash);
            expect(result.missingAssets).toBe(0);
        }
    });

    it('rejects a tampered project file', async () => {
        const project = createProject({ name: 'Tamper', areaId: null });
        const { blob } = await exportAstac(project, { includeArea: false });
        const files = await readZip(new Uint8Array(await blob.arrayBuffer()));
        const changed = new TextEncoder().encode(new TextDecoder().decode(files.get('project.json')).replace('Tamper', 'Tampex'));
        const rezipped = zipSync({ 'manifest.json': files.get('manifest.json')!, 'project.json': changed });
        await expect(readImportFile(new Blob([new Uint8Array(rezipped)]), nowhere)).rejects.toThrow('archive-checksum');
    });

    it('refuses path traversal and oversized declarations', async () => {
        const evil = zipSync({ '../evil.json': strToU8('{}'), 'manifest.json': strToU8('{}') });
        await expect(readZip(evil)).rejects.toThrow('archive');
        const big = zipSync({ 'manifest.json': strToU8('x'.repeat(5000)) });
        await expect(readZip(big, { maxArchive: 1e6, maxEntries: 10, maxEntry: 1000, maxTotal: 1000 })).rejects.toThrow('archive-too-large');
    });
});

describe('TacMap import', () => {
    it('converts a geo-calibrated map and binds its elements', async () => {
        const image = png();
        const hash = await sha256Hex(image);
        // Two tie points 1000 px apart, ~1 km apart on the ground (Zürich).
        const tl: [number, number] = [8.5300, 47.3800];
        const br: [number, number] = [8.5432, 47.3720];
        const project = {
            id: 'p1', formatVersion: 1, name: 'TacMap Test', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', activeMapId: 'map1',
            teams: [{ id: 't1', name: 'Alpha', color: '#2f6fc4', callsign: 'A1' }],
            phases: [{ id: 'ph1', name: 'H-Hour' }],
            maps: [{
                id: 'map1', name: 'Gelände', image: hash, width: 1000, height: 800, overlays: [],
                calibration: { kind: 'geo', points: [{ px: { x: 0, y: 0 }, lat: tl[1], lon: tl[0] }, { px: { x: 1000, y: 800 }, lat: br[1], lon: br[0] }] },
                elements: [
                    { kind: 'marker', id: 'e1', pos: { x: 0, y: 0 }, symbol: 'hq', teamId: 't1', phaseId: 'ph1' },
                    { kind: 'zone', id: 'e2', shape: { type: 'circle', c: { x: 500, y: 400 }, r: 50 }, color: '#ff0000', fillOpacity: 0.2, category: 'nogo' },
                    { kind: 'route', id: 'e3', points: [{ x: 0, y: 0 }, { x: 1000, y: 800 }], style: 'planned', arrow: true },
                ],
                drawings: [],
            }],
            eventLog: [], tracks: [], settings: { gridEnabled: false },
        };
        const json = JSON.stringify(project);
        const manifest = { format: 'tacmap', formatVersion: 1, appVersion: '0.12.0', createdWith: 'TacMap 0.12.0', checksum: await sha256Hex(json), assets: [{ hash, mime: 'image/png', size: image.length }] };
        const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'project.json': strToU8(json), [`assets/${hash}.png`]: image });
        const result = await readImportFile(new Blob([new Uint8Array(zip)]), nowhere);
        expect(result.kind).toBe('project');
        if (result.kind !== 'project') {
            return;
        }
        const converted: Project = result.project;
        expect(result.unaligned).toEqual([]);
        expect(converted.images).toHaveLength(1);
        const hq = converted.elements.find((e) => e.kind === 'marker');
        expect(hq && hq.kind === 'marker' && distanceM(hq.pos, tl)).toBeLessThan(0.5);
        expect(hq?.teamId).toBe(converted.teams[0].id);
        expect(hq?.phaseIds).toEqual([converted.phases[0].id]);
        expect(hq?.anchorImageId).toBe(converted.images[0].id);
        const zone = converted.elements.find((e) => e.kind === 'zone');
        // 50 px at ~1.27 m/px ≈ 63 m.
        expect(zone && zone.kind === 'zone' && zone.shape.type === 'circle' && zone.shape.radiusM).toBeGreaterThan(50);
    });
});

describe('plan links', () => {
    it('round-trips a small plan through #plan=', async () => {
        const project = createProject({ name: 'Link', areaId: 'mahlwinkel' });
        project.elements.push({ kind: 'marker', id: 'm1', pos: [11.82, 52.38], type: 'unit', label: 'A' });
        const link = encodePlanLink(project, 'https://example.test/');
        expect(link).not.toBeNull();
        const decoded = await decodePlanLink(link!.slice('https://example.test/'.length));
        expect(decoded.elements).toEqual(project.elements);
    });
});

describe('import hygiene', () => {
    it('reuses an area already on the device instead of forking it on every import', async () => {
        const { saveArea } = await import('../../src/core/areas/store');
        const { db } = await import('../../src/core/storage/db');
        // Feature ids are dropped by sanitizing, so the stored (raw) hash differs from an import's.
        const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'way/1', properties: { highway: 'track' }, geometry: { type: 'LineString', coordinates: [[8.5, 47.3], [8.51, 47.31]] } }] };
        await saveArea({ format: 'as-tac-map', formatVersion: 1, id: 'testfeld', name: 'Testfeld', bounds: [8.49, 47.29, 8.52, 47.32], dataTimestamp: '2026-11-01', source: 'test', attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0', byteSize: 100, sha256: await sha256Hex(JSON.stringify(data)), data });
        const project = createProject({ name: 'Mit Gebiet', areaId: 'testfeld' });
        const { blob } = await exportAstac(project, { includeArea: true });
        const before = await db.areaMeta.count();
        for (let i = 0; i < 2; i++) {
            const result = await readImportFile(blob, nowhere);
            expect(result.kind === 'project' && result.project.areaId).toBeTruthy();
        }
        // At most one sanitized copy is added, and repeated imports reuse it.
        expect(await db.areaMeta.count()).toBeLessThanOrEqual(before + 1);
        const again = await readImportFile(blob, nowhere);
        const once = await readImportFile(blob, nowhere);
        expect(again.kind === 'project' && once.kind === 'project' && again.project.areaId === once.project.areaId).toBe(true);
    });

    it('drops TacMap objects with broken coordinates instead of failing the import, and binds ink to the map', async () => {
        const image = png();
        const hash = await sha256Hex(image);
        const project = {
            id: 'p2', formatVersion: 1, name: 'Kaputt', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', activeMapId: 'm',
            teams: [], phases: [], eventLog: [], tracks: [{ id: 't', name: 'x', mapId: 'm', startedAt: 'x', points: [{ pos: { x: 1, y: 1 }, lon: 200, lat: 47, t: 'x' }, { pos: { x: 2, y: 2 }, t: 'y' }] }],
            maps: [{
                id: 'm', name: 'Skizze', image: hash, width: 1000, height: 800, overlays: [],
                calibration: { kind: 'geo', points: [{ px: { x: 0, y: 0 }, lat: 47.38, lon: 8.53 }, { px: { x: 1000, y: 800 }, lat: 47.372, lon: 8.5432 }] },
                elements: [{ kind: 'marker', id: 'ok', pos: { x: 10, y: 10 }, symbol: 'unit' }, { kind: 'marker', id: 'bad', pos: { x: 10, y: -1e8 }, symbol: 'unit' }],
                drawings: [{ id: 's', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], color: '#ff0000', width: 4 }],
            }],
            settings: { gridEnabled: false },
        };
        const json = JSON.stringify(project);
        const manifest = { format: 'tacmap', formatVersion: 1, appVersion: '0.12.0', createdWith: 'x', checksum: await sha256Hex(json), assets: [{ hash, mime: 'image/png', size: image.length }] };
        const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'project.json': strToU8(json), [`assets/${hash}.png`]: image });
        const result = await readImportFile(new Blob([new Uint8Array(zip)]), nowhere);
        expect(result.kind).toBe('project');
        if (result.kind === 'project') {
            expect(result.project.elements).toHaveLength(1);
            expect(result.skipped).toBeGreaterThanOrEqual(1);
            expect(result.project.drawings[0].anchorImageId).toBe(result.project.images[0].id);
        }
    });

    it('rejects a TacMap file without its checksum', async () => {
        const json = JSON.stringify({ maps: [], activeMapId: 'm' });
        const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'tacmap', formatVersion: 1, assets: [] })), 'project.json': strToU8(json) });
        await expect(readImportFile(new Blob([new Uint8Array(zip)]), nowhere)).rejects.toThrow('archive-checksum');
    });
});

describe('asset store', () => {
    it('keeps bytes that are not really an image inert and never renders them', async () => {
        const fake = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
        const row = await putAsset(new Blob([fake], { type: 'image/png' }), 'fake.png');
        expect(row.mime).toBe('application/octet-stream');
        expect(isRenderableImage(row)).toBe(false);
        expect(await assetUrl(row.hash)).toBeNull();
        const hash = await sha256Hex(fake.slice(0, 20));
        await putVerifiedAsset(hash, fake.slice(0, 20), 'image/jpeg');
        expect(isRenderableImage(await getAsset(hash))).toBe(false);
        const real = await putAsset(new Blob([new Uint8Array(png())], { type: 'image/png' }), 'real.png');
        expect(isRenderableImage(real)).toBe(true);
    });
});
