import presets from '../../config/maps.json';
import { db, type AreaRow } from '../storage/db';
import { sha256Hex } from '../storage/assets';
import type { Bounds } from '../geo/geo';
import type { AreaMeta, AreaPackage, BundledArea } from './types';

const DESCRIPTIONS: Record<string, string> = {
    mahlwinkel: 'Airsoft-Gelände Mahlwinkel (DE) mit FieldMaps-Eventvorlagen',
    benglen: 'Testgebiet Benglen (ZH)',
    zurich: 'Zürich-West, Zentrum bis Benglen, inkl. ZHAW Lagerstrasse und Toni-Areal',
};
const SIZES: Record<string, number> = { mahlwinkel: 305055, benglen: 1650000, zurich: 24866859 };

export const BUNDLED_AREAS: BundledArea[] = (presets as { id: string; name: string; bounds: number[] }[]).map((preset) => ({
    id: preset.id,
    name: preset.name,
    bounds: preset.bounds as Bounds,
    file: `/maps/${preset.id}.geojson`,
    approxBytes: SIZES[preset.id] ?? 0,
    description: DESCRIPTIONS[preset.id] ?? '',
}));

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
    const value = input as AreaPackage;
    if (!value || typeof value !== 'object' || value.format !== 'as-tac-map' || value.formatVersion !== 1
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
    const preset = BUNDLED_AREAS.find((area) => area.id === id);
    if (!preset) {
        throw new Error('area-unknown');
    }
    // A weak link may drop the request or the transfer midway: the whole file, a few tries.
    // Offline there is nothing to wait for.
    const getBytes = async (url: string, init?: RequestInit, report?: (received: number, total: number) => void): Promise<Uint8Array> => {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                throw new Error('offline');
            }
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
            } finally {
                clearTimeout(stall);
            }
            if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, 2000 * 3 ** attempt));
            }
        }
        throw lastError instanceof Error ? lastError : new Error('download');
    };
    const manifest = JSON.parse(new TextDecoder().decode(await getBytes(`/maps/${id}.json`, { cache: 'no-cache' }))) as Omit<AreaPackage, 'data' | 'format' | 'formatVersion'>;
    const bytes = await getBytes(preset.file, undefined, (received, length) => {
        const total = length || manifest.byteSize || preset.approxBytes;
        onProgress?.(total ? Math.min(1, received / total) : null, 'download');
    });
    onProgress?.(null, 'verify');
    const hash = await sha256Hex(bytes);
    if (hash !== manifest.sha256) {
        throw new Error('area-checksum');
    }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as GeoJSON.FeatureCollection;
    onProgress?.(null, 'save');
    return saveArea({
        format: 'as-tac-map',
        formatVersion: 1,
        id,
        name: preset.name,
        bounds: preset.bounds,
        dataTimestamp: manifest.dataTimestamp,
        source: manifest.source,
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
    if (BUNDLED_AREAS.some((area) => area.id === id)) {
        return installBundled(id, onProgress);
    }
    return null;
}

export function areaCenter(bounds: Bounds): [number, number] {
    return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}
