import osmtogeojson from 'osmtogeojson';
import { boundsSizeM, type Bounds } from '../geo/geo';
import { sha256Hex } from '../storage/assets';
import type { AreaPackage } from './types';
import { MAX_FEATURES, validateBounds } from './store';

/** Public Overpass instances; the second is only tried when the first is unreachable or overloaded. */
export const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
export const MAX_AREA_KM2 = 36;
const MIN_INTERVAL_MS = 30000;

/** Tags kept in the offline basemap. Contact and address data are dropped on purpose. */
export const KEPT_TAGS = new Set([
    'name', 'ref', 'highway', 'tracktype', 'surface', 'building', 'landuse', 'natural', 'waterway', 'water', 'wetland', 'amenity', 'tourism',
    'leisure', 'place', 'railway', 'power', 'barrier', 'man_made', 'military', 'bridge', 'tunnel', 'layer', 'access', 'historic', 'ruins',
]);

export function areaKm2(bounds: Bounds): number {
    const { width, height } = boundsSizeM(bounds);
    return (width * height) / 1e6;
}

export function overpassQuery(bounds: Bounds): string {
    const bbox = [bounds[1], bounds[0], bounds[3], bounds[2]].map((n) => n.toFixed(6)).join(',');
    return `[out:json][timeout:120][maxsize:268435456];(
way[highway](${bbox});way[building](${bbox});way[landuse](${bbox});way[natural](${bbox});way[waterway](${bbox});
way[leisure](${bbox});way[railway](${bbox});way[barrier](${bbox});way[power](${bbox});way[man_made](${bbox});way[military](${bbox});
relation[type=multipolygon][landuse](${bbox});relation[type=multipolygon][natural](${bbox});relation[type=multipolygon][building](${bbox});
node[name][place](${bbox});node[name][amenity](${bbox});node[name][tourism](${bbox});node[power=generator](${bbox});node[natural=peak](${bbox});node[man_made~"tower|mast"](${bbox});
);out body;>;out skel qt;`;
}

export interface OverpassResponse {
    elements: unknown[];
    osm3s?: { timestamp_osm_base?: string };
    remark?: string;
}

/** Convert raw Overpass JSON into the compact offline basemap collection. */
export function toBasemap(raw: OverpassResponse): GeoJSON.FeatureCollection {
    if (raw.remark && /runtime error|timed out|out of memory/i.test(raw.remark)) {
        throw new Error('overpass-incomplete');
    }
    const geojson = osmtogeojson(raw as never, { flatProperties: true }) as GeoJSON.FeatureCollection;
    const features: GeoJSON.Feature[] = [];
    for (const feature of geojson.features) {
        if (!feature.geometry) {
            continue;
        }
        const properties: Record<string, string> = {};
        for (const [key, value] of Object.entries(feature.properties ?? {})) {
            if (KEPT_TAGS.has(key) && typeof value === 'string') {
                properties[key] = value;
            }
        }
        if (Object.keys(properties).length === 0) {
            continue;
        }
        features.push({ type: 'Feature', properties, geometry: feature.geometry });
    }
    if (features.length > MAX_FEATURES) {
        throw new Error('area-too-many-features');
    }
    return { type: 'FeatureCollection', features };
}

let lastRequest = 0;

export function secondsUntilNextDownload(): number {
    return Math.max(0, Math.ceil((lastRequest + MIN_INTERVAL_MS - Date.now()) / 1000));
}

export type DownloadPhase = 'download' | 'convert' | 'verify';

/**
 * Areas are fetched in tiles of at most this size. On a weak mobile link a dropped connection
 * then costs one tile, not the whole area; finished tiles are kept for the next attempt.
 */
export const TILE_KM2 = 4;
const TILE_ATTEMPTS = 4;
const TILE_PAUSE_MS = 1000;
/** No byte for this long: the connection is dead, try again (mobile links stall silently). */
const STALL_MS = 45000;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const CACHE_MS = 30 * 60 * 1000;

/** Split `[west, south, east, north]` into a grid of tiles of at most `maxKm2` each. */
export function tileBounds(bounds: Bounds, maxKm2 = TILE_KM2): Bounds[] {
    const { width, height } = boundsSizeM(bounds);
    const side = Math.sqrt(maxKm2) * 1000;
    const nx = Math.max(1, Math.ceil(width / side));
    const ny = Math.max(1, Math.ceil(height / side));
    const [west, south, east, north] = bounds;
    const tiles: Bounds[] = [];
    for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
            tiles.push([
                west + ((east - west) * x) / nx,
                south + ((north - south) * y) / ny,
                west + ((east - west) * (x + 1)) / nx,
                south + ((north - south) * (y + 1)) / ny,
            ]);
        }
    }
    return tiles;
}

type OsmElement = { type: string; id: number; tags?: Record<string, string> };

/**
 * Join tile answers. Ways and relations crossing a tile border come with all their nodes in
 * every tile that touches them (`>`), so each copy is complete; duplicates are dropped. A node
 * seen bare (way member) in one tile and tagged (place, amenity) in another keeps its tags.
 */
export function mergeTiles(responses: OverpassResponse[]): OverpassResponse {
    const byKey = new Map<string, OsmElement>();
    let timestamp: string | undefined;
    for (const response of responses) {
        for (const raw of response.elements as OsmElement[]) {
            const key = `${raw.type}/${raw.id}`;
            const existing = byKey.get(key);
            if (!existing || (!existing.tags && raw.tags)) {
                byKey.set(key, raw);
            }
        }
        const stamp = response.osm3s?.timestamp_osm_base;
        if (stamp && (!timestamp || stamp < timestamp)) {
            timestamp = stamp;
        }
    }
    return { elements: [...byKey.values()], osm3s: timestamp ? { timestamp_osm_base: timestamp } : undefined };
}

/** Finished tiles by query, kept so a failed or cancelled download continues where it stopped. */
const tileCache = new Map<string, { at: number; response: OverpassResponse; bytes: number }>();

/** How many tiles of this area are already on the device (from an earlier, interrupted try). */
export function cachedTiles(bounds: Bounds): number {
    const now = Date.now();
    return tileBounds(bounds).filter((tile) => (tileCache.get(overpassQuery(tile))?.at ?? 0) > now - CACHE_MS).length;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        }, { once: true });
    });
}

async function fetchOverpass(endpoint: string, query: string, signal: AbortSignal, onBytes: (bytes: number) => void): Promise<{ response: OverpassResponse; bytes: number }> {
    // Own controller: a stalled connection is cut and retried without cancelling the download.
    const attempt = new AbortController();
    const cancel = () => attempt.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let stall = setTimeout(() => attempt.abort(), STALL_MS);
    const alive = () => {
        clearTimeout(stall);
        stall = setTimeout(() => attempt.abort(), STALL_MS);
    };
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: new URLSearchParams({ data: query }),
            signal: attempt.signal,
        });
        if (response.status === 429 || response.status === 504) {
            throw new Error('rate-limit');
        }
        if (!response.ok || !response.body) {
            throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
            alive();
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            chunks.push(value);
            total += value.length;
            onBytes(total);
            if (total > MAX_TOTAL_BYTES) {
                await reader.cancel();
                throw new Error('area-too-large');
            }
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as OverpassResponse;
        if (parsed.remark && /runtime error|timed out|out of memory/i.test(parsed.remark)) {
            throw new Error('overpass-incomplete');
        }
        return { response: parsed, bytes: total };
    } catch (error) {
        if (!signal.aborted && attempt.signal.aborted) {
            throw new Error('stalled');
        }
        throw error;
    } finally {
        clearTimeout(stall);
        signal.removeEventListener('abort', cancel);
    }
}

/** One tile: both servers, several rounds with growing pauses (longer when rate-limited). */
async function fetchTile(query: string, signal: AbortSignal, onBytes: (bytes: number) => void): Promise<{ response: OverpassResponse; bytes: number }> {
    let lastError: unknown = null;
    for (let round = 0; round < TILE_ATTEMPTS; round++) {
        for (const endpoint of OVERPASS_ENDPOINTS) {
            try {
                return await fetchOverpass(endpoint, query, signal, onBytes);
            } catch (error) {
                if (signal.aborted || (error instanceof Error && error.message === 'area-too-large')) {
                    throw error;
                }
                lastError = error;
            }
        }
        if (round < TILE_ATTEMPTS - 1) {
            const limited = lastError instanceof Error && lastError.message === 'rate-limit';
            await sleep(limited ? 15000 * (round + 1) : 2000 * 3 ** round, signal);
        }
    }
    throw lastError instanceof Error ? lastError : new Error('download');
}

export interface DownloadOptions {
    id: string;
    name: string;
    bounds: Bounds;
    signal: AbortSignal;
    /** `part`: tiles finished so far and in total. */
    onProgress: (phase: DownloadPhase, bytes: number, part?: { done: number; total: number }) => void;
}

export async function downloadArea(options: DownloadOptions): Promise<AreaPackage> {
    validateBounds(options.bounds);
    if (areaKm2(options.bounds) > MAX_AREA_KM2) {
        throw new Error('area-too-large');
    }
    if (!navigator.onLine) {
        throw new Error('offline');
    }
    const wait = secondsUntilNextDownload();
    if (wait > 0) {
        throw new Error(`rate-limit:${wait}`);
    }
    lastRequest = Date.now();
    const tiles = tileBounds(options.bounds);
    const responses: OverpassResponse[] = [];
    let finishedBytes = 0;
    const now = Date.now();
    for (const [key, entry] of tileCache) {
        if (entry.at < now - CACHE_MS) {
            tileCache.delete(key);
        }
    }
    for (const [index, tile] of tiles.entries()) {
        options.signal.throwIfAborted();
        const query = overpassQuery(tile);
        let entry = tileCache.get(query);
        if (!entry) {
            if (index > 0) {
                // Sequential and with a pause: the public Overpass servers are shared.
                await sleep(TILE_PAUSE_MS, options.signal);
            }
            const fetched = await fetchTile(query, options.signal, (bytes) => options.onProgress('download', finishedBytes + bytes, { done: index, total: tiles.length }));
            entry = { at: Date.now(), ...fetched };
            tileCache.set(query, entry);
        }
        finishedBytes += entry.bytes;
        if (finishedBytes > MAX_TOTAL_BYTES) {
            throw new Error('area-too-large');
        }
        responses.push(entry.response);
        options.onProgress('download', finishedBytes, { done: index + 1, total: tiles.length });
    }
    const raw = tiles.length === 1 ? responses[0] : mergeTiles(responses);
    options.signal.throwIfAborted();
    options.onProgress('convert', 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const data = toBasemap(raw);
    options.signal.throwIfAborted();
    options.onProgress('verify', 0);
    const text = JSON.stringify(data);
    const pkg: AreaPackage = {
        format: 'as-tac-map',
        formatVersion: 1,
        id: options.id,
        name: options.name,
        bounds: options.bounds,
        dataTimestamp: raw.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
        source: `OpenStreetMap via Overpass API (${OVERPASS_ENDPOINTS[0]})`,
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL 1.0',
        byteSize: new TextEncoder().encode(text).byteLength,
        sha256: await sha256Hex(text),
        featureCount: data.features.length,
        origin: 'download',
        data,
    };
    // Done: the tiles of this area are no longer needed in memory.
    for (const tile of tiles) {
        tileCache.delete(overpassQuery(tile));
    }
    return pkg;
}

export function slugId(name: string): string {
    const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'gebiet';
    return `${base}-${Date.now().toString(36)}`;
}
