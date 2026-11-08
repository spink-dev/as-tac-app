import { db } from '../storage/db';
import { BUNDLED_AREAS, saveArea, verifyArea } from './store';
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

/**
 * Import an area package without duplicating what is already here:
 * - a bundled id always means the installed bundled area (never forked, never replaced);
 * - the same content (by sanitized hash) is reused under whatever id it already has;
 * - only genuinely different data under a taken (or bundled) id gets a new id.
 */
export async function importAreaPackage(raw: unknown): Promise<AreaMeta> {
    const pkg = await sanitizeArea(await verifyArea(raw));
    const bundled = BUNDLED_AREAS.some((area) => area.id === pkg.id);
    const existing = (await db.areaMeta.get(pkg.id))?.meta;
    if (existing && (bundled || existing.sha256 === pkg.sha256 || existing.contentSha256 === pkg.sha256)) {
        return existing;
    }
    const same = (await db.areaMeta.toArray()).find((row) => row.meta.contentSha256 === pkg.sha256 || row.meta.sha256 === pkg.sha256);
    if (same) {
        return same.meta;
    }
    const id = existing || bundled ? `${pkg.id.slice(0, 100)}-${Date.now().toString(36)}` : pkg.id;
    return saveArea({ ...pkg, id, origin: 'import', contentSha256: pkg.sha256 });
}

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);
const MAX_VERTICES = 4_000_000;
/** Array nesting above a single position, per geometry type. */
const NESTING: Record<string, number> = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };

function validPosition(value: unknown): boolean {
    return Array.isArray(value) && value.length >= 2 && value.length <= 3
        && typeof value[0] === 'number' && typeof value[1] === 'number' && Number.isFinite(value[0]) && Number.isFinite(value[1])
        && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

/**
 * Vertex count of a well-formed geometry, or `null`. Iterative with the exact nesting depth of
 * the type, so hostile input can't blow the stack or smuggle non-numeric coordinates.
 */
function geometryVertices(type: string, coordinates: unknown): number | null {
    const depth = NESTING[type];
    let level: unknown[] = [coordinates];
    for (let d = 0; d < depth; d++) {
        const next: unknown[] = [];
        for (const item of level) {
            if (!Array.isArray(item) || item.length === 0) {
                return null;
            }
            for (const child of item) {
                next.push(child);
            }
        }
        level = next;
    }
    return level.every(validPosition) ? level.length : null;
}

/** Keep only known envelope fields and well-formed features with string properties. */
export async function sanitizeArea(pkg: AreaPackage): Promise<AreaPackage> {
    const features: GeoJSON.Feature[] = [];
    let vertices = 0;
    for (const feature of pkg.data.features) {
        const geometry = feature?.geometry as { type?: unknown; coordinates?: unknown } | null;
        if (!geometry || !GEOMETRY_TYPES.has(String(geometry.type)) || !Array.isArray(geometry.coordinates)) {
            continue;
        }
        const count = geometryVertices(String(geometry.type), geometry.coordinates);
        if (count === null) {
            continue;
        }
        vertices += count;
        if (vertices > MAX_VERTICES) {
            throw new Error('area-too-large');
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
