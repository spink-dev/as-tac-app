import { db } from '../storage/db';
import { saveArea, verifyArea } from './store';
import { sha256Hex } from '../storage/assets';
import type { AreaMeta, AreaPackage } from './types';

/** `.astac-map.json` — the offline basemap as a standalone file (same envelope as as-tac 0.6, ids not interchangeable). */
export async function exportAreaFile(id: string): Promise<{ blob: Blob; filename: string }> {
    const row = await db.areas.get(id);
    if (!row) {
        throw new Error('area-unknown');
    }
    const pkg: AreaPackage = { ...row.meta, format: 'as-tac-map', formatVersion: 1, data: row.data };
    delete pkg.installedAt;
    const blob = new Blob([JSON.stringify(pkg)], { type: 'application/json' });
    return { blob, filename: `${id}.astac-map.json` };
}

/** Import an area package. Same id and hash: reuse. Same id, different data: keep both. */
export async function importAreaPackage(raw: unknown): Promise<AreaMeta> {
    const pkg = await sanitizeArea(await verifyArea(raw));
    const existing = (await db.areaMeta.get(pkg.id))?.meta;
    if (existing && existing.sha256 === pkg.sha256) {
        return existing;
    }
    const id = existing ? `${pkg.id.slice(0, 100)}-${Date.now().toString(36)}` : pkg.id;
    return saveArea({ ...pkg, id, origin: 'import' });
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);

/** Keep only known envelope fields and well-formed features with string properties. */
export async function sanitizeArea(pkg: AreaPackage): Promise<AreaPackage> {
    const features: GeoJSON.Feature[] = [];
    for (const feature of pkg.data.features) {
        const geometry = feature?.geometry as { type?: unknown; coordinates?: unknown } | null;
        if (!geometry || !GEOMETRY_TYPES.has(String(geometry.type)) || !Array.isArray(geometry.coordinates)) {
            continue;
        }
        const properties: Record<string, string> = {};
        for (const [key, value] of Object.entries(feature.properties ?? {})) {
            if (typeof value === 'string' && key.length <= 64) {
                properties[key] = value.slice(0, 256);
            }
        }
        features.push({ type: 'Feature', properties, geometry: geometry as GeoJSON.Geometry });
    }
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    const text = JSON.stringify(data);
    return {
        format: 'as-tac-map', formatVersion: 1, id: pkg.id, name: pkg.name.slice(0, 160), bounds: pkg.bounds,
        dataTimestamp: String(pkg.dataTimestamp).slice(0, 40), source: String(pkg.source).slice(0, 400),
        attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0', byteSize: new TextEncoder().encode(text).byteLength, sha256: await sha256Hex(text),
        featureCount: features.length, data,
    };
}
