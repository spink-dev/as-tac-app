import { isJson, migrateRecord, versionOf } from '../model/migrations';
import { db, type AreaRow } from '../storage/db';
import { sha256Hex } from '../storage/assets';
import type { Bounds } from '../geo/geo';
import { AREA_FORMAT_VERSION, AREA_STEPS, type AreaMeta, type AreaPackage } from './types';
import { BUNDLED_AREAS, bundledArea, isBundled } from './catalog';

export { BUNDLED_AREAS, bundledArea, isBundled };

export const MAX_FEATURES = 150000;
export const MAX_AREA_BYTES = 60 * 1024 * 1024;

export function validateBounds(bounds: unknown): asserts bounds is Bounds {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every((n) => typeof n === 'number' && Number.isFinite(n))
        || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -85 || bounds[3] > 85 || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
        throw new Error('bounds');
    }
}

/** Validate an untrusted area package (download, file import, legacy database). */
export async function verifyArea(input: unknown): Promise<AreaPackage> {
    if (!isJson(input) || input.format !== 'as-tac-map') {
        throw new Error('area-invalid');
    }
    const value = migrateRecord(input, versionOf(input), AREA_FORMAT_VERSION, AREA_STEPS, 'area', 'formatVersion') as unknown as AreaPackage;
    if (value.formatVersion !== AREA_FORMAT_VERSION
        || typeof value.id !== 'string' || !/^[\w.-]{1,120}$/.test(value.id) || typeof value.name !== 'string' || value.name.length > 160
        || typeof value.sha256 !== 'string' || !value.data || value.data.type !== 'FeatureCollection' || !Array.isArray(value.data.features)) {
        throw new Error('area-invalid');
    }
    validateBounds(value.bounds);
    if (value.data.features.length > MAX_FEATURES) {
        throw new Error('area-too-many-features');
    }
    const text = JSON.stringify(value.data);
    if (text.length > MAX_AREA_BYTES) {
        throw new Error('area-too-large');
    }
    // Packages written by as-tac ≤ 0.6 hash the exact stored GeoJSON text.
    const hash = await sha256Hex(text);
    if (hash !== value.sha256) {
        throw new Error('area-checksum');
    }
    return value;
}

export async function listAreas(): Promise<AreaMeta[]> {
    const rows = await db.areaMeta.toArray();
    return rows.map((row) => row.meta).sort((a, b) => a.name.localeCompare(b.name));
}

export async function hasArea(id: string): Promise<AreaMeta | undefined> {
    return (await db.areaMeta.get(id))?.meta;
}

export async function getArea(id: string): Promise<AreaRow | undefined> {
    return db.areas.get(id);
}

export async function saveArea(pkg: AreaPackage): Promise<AreaMeta> {
    const { data, ...meta } = pkg;
    const stored: AreaMeta = { ...meta, installedAt: new Date().toISOString(), featureCount: data.features.length };
    await db.transaction('rw', db.areas, db.areaMeta, async () => {
        await db.areas.put({ id: pkg.id, meta: stored, data });
        await db.areaMeta.put({ id: pkg.id, meta: stored });
    });
    return stored;
}

export async function removeArea(id: string): Promise<void> {
    await db.transaction('rw', db.areas, db.areaMeta, async () => {
        await db.areas.delete(id);
        await db.areaMeta.delete(id);
    });
}

export async function areaUsage(id: string): Promise<number> {
    return db.projectIndex.filter((row) => row.areaId === id).count();
}

export type Progress = (fraction: number | null, phase: 'download' | 'verify' | 'save') => void;

/** Copy a bundled area from the app's own server into IndexedDB for offline use. */
export async function installBundled(id: string, onProgress?: Progress): Promise<AreaMeta> {
    const preset = bundledArea(id);
    if (!preset) {
        throw new Error('area-unknown');
    }
    // A weak link may drop the request or the transfer midway: the whole file, a few tries.
    // Offline the request still goes out (the service worker answers for precached Mahlwinkel);
    // when it fails there is nothing to wait for.
    const getBytes = async (url: string, init?: RequestInit, report?: (received: number, total: number) => void): Promise<Uint8Array> => {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            // A transfer that stops moving for 30 s is cut and tried again (mobile links stall silently).
            const transfer = new AbortController();
            let stall = setTimeout(() => transfer.abort(), 60000);
            const alive = () => {
                clearTimeout(stall);
                stall = setTimeout(() => transfer.abort(), 30000);
            };
            try {
                const response = await fetch(url, { ...init, signal: transfer.signal });
                alive();
                if (!response.ok || !response.body) {
                    void response.body?.cancel().catch(() => undefined);
                    lastError = new Error(`HTTP ${response.status}`);
                    if (response.status < 500) {
                        break;
                    }
                } else {
                    const total = Number(response.headers.get('content-length')) || 0;
                    const reader = response.body.getReader();
                    const chunks: Uint8Array[] = [];
                    let received = 0;
                    while (true) {
                        const { value, done } = await reader.read();
                        alive();
                        if (done) {
                            break;
                        }
                        chunks.push(value);
                        received += value.length;
                        report?.(received, total);
                    }
                    const bytes = new Uint8Array(received);
                    let offset = 0;
                    for (const chunk of chunks) {
                        bytes.set(chunk, offset);
                        offset += chunk.length;
                    }
                    return bytes;
                }
            } catch (error) {
                lastError = transfer.signal.aborted ? new Error('stalled') : error;
                if (!transfer.signal.aborted && typeof navigator !== 'undefined' && navigator.onLine === false) {
                    throw new Error('offline');
                }
            } finally {
                clearTimeout(stall);
            }
            if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, 2000 * 3 ** attempt));
            }
        }
        throw lastError instanceof Error ? lastError : new Error('download');
    };
    // The catalog in this build names the exact file (size and SHA-256), so no manifest is fetched.
    const bytes = await getBytes(preset.file, undefined, (received, length) => {
        const total = length || preset.bytes;
        onProgress?.(total ? Math.min(1, received / total) : null, 'download');
    });
    onProgress?.(null, 'verify');
    const hash = await sha256Hex(bytes);
    if (hash !== preset.sha256) {
        throw new Error('area-checksum');
    }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as GeoJSON.FeatureCollection;
    onProgress?.(null, 'save');
    return saveArea({
        format: 'as-tac-map',
        formatVersion: AREA_FORMAT_VERSION,
        id,
        name: preset.name,
        bounds: preset.bounds,
        dataTimestamp: preset.dataTimestamp,
        source: `OpenStreetMap via Overpass API (${preset.source})`,
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL 1.0',
        byteSize: bytes.byteLength,
        sha256: hash,
        origin: 'bundled',
        data,
    });
}

export async function ensureArea(id: string, onProgress?: Progress): Promise<AreaMeta | null> {
    const existing = await hasArea(id);
    if (existing) {
        return existing;
    }
    if (isBundled(id)) {
        return installBundled(id, onProgress);
    }
    return null;
}

export function areaCenter(bounds: Bounds): [number, number] {
    return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}
