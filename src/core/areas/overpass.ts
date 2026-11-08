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

/** `wait`: a pause before the next attempt (bytes = seconds left). */
export type DownloadPhase = 'download' | 'wait' | 'convert' | 'verify';

/**
 * Areas are fetched in tiles of at most this size. On a weak mobile link a dropped connection
 * then costs one tile, not the whole area; finished tiles are kept for the next attempt.
 */
export const TILE_KM2 = 4;
const TILE_ROUNDS = 3;
const TILE_PAUSE_MS = 1000;
/** Overpass may think for up to its query timeout (120 s) before the first byte. */
const FIRST_BYTE_MS = 150000;
/** After that, no byte for this long means the connection is dead (mobile links stall silently). */
const STALL_MS = 45000;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const CACHE_MS = 30 * 60 * 1000;
/** A retry counts as the same area when the frame overlaps the interrupted one this much. */
const SAME_AREA = 0.9;

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

/** Overlap of two areas: intersection over union (1 = identical). */
function overlap(a: Bounds, b: Bounds): number {
    const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = w * h;
    const area = (x: Bounds) => (x[2] - x[0]) * (x[3] - x[1]);
    return inter / (area(a) + area(b) - inter || 1);
}

/**
 * The one interrupted download kept for resuming: its exact frame, finished tiles and endpoints
 * used. Only one area is kept, and only for 30 minutes (parsed tiles are large).
 */
let pending: { bounds: Bounds; tiles: Map<string, { response: OverpassResponse; bytes: number }>; endpoints: Set<string>; expiry: ReturnType<typeof setTimeout> | null } | null = null;

function dropPending() {
    if (pending?.expiry) {
        clearTimeout(pending.expiry);
    }
    pending = null;
}

/** The frame to download: the interrupted one when the new frame is (nearly) the same area. */
export function resumeBounds(bounds: Bounds): Bounds {
    return pending && pending.tiles.size > 0 && overlap(pending.bounds, bounds) >= SAME_AREA ? pending.bounds : bounds;
}

/** How many tiles a download of this frame would not need to fetch again. */
export function cachedTiles(bounds: Bounds): number {
    return pending && resumeBounds(bounds) === pending.bounds ? pending.tiles.size : 0;
}

/** Forget a kept, interrupted download (dialog closed for good, or a retry would fail the same way). */
export function discardResume() {
    dropPending();
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/** Errors a retry would only repeat: no point asking the servers again. */
const permanent = (error: unknown) => error instanceof Error && /^(area-too-large|area-too-many-features|overpass-format|HTTP 400)$/.test(error.message);

async function fetchOverpass(endpoint: string, query: string, signal: AbortSignal, budget: number, onBytes: (bytes: number) => void): Promise<{ response: OverpassResponse; bytes: number }> {
    // Own controller: a stalled connection is cut and retried without cancelling the download.
    const attempt = new AbortController();
    const cancel = () => attempt.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let stall = setTimeout(() => attempt.abort(), FIRST_BYTE_MS);
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
        if (!response.ok || !response.body) {
            void response.body?.cancel().catch(() => undefined);
            if (response.status === 429 || response.status === 504) {
                const after = Number(response.headers.get('retry-after'));
                throw Object.assign(new Error('rate-limit'), { retryAfter: Number.isFinite(after) && after > 0 ? Math.min(after, 300) : 0 });
            }
            throw new Error(`HTTP ${response.status}`);
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
            const { value, done } = await reader.read();
            alive();
            if (done) {
                break;
            }
            chunks.push(value);
            total += value.length;
            onBytes(total);
            if (total > budget) {
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
        if (!Array.isArray(parsed.elements)) {
            throw new Error('overpass-format');
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
        attempt.abort();
    }
}

/** One tile: both servers, a few rounds with growing pauses (Retry-After when rate-limited). */
async function fetchTile(query: string, signal: AbortSignal, budget: number, onBytes: (bytes: number) => void, onWait: (seconds: number) => void, used: Set<string>): Promise<{ response: OverpassResponse; bytes: number }> {
    let lastError: unknown = null;
    let incomplete = 0;
    for (let round = 0; round < TILE_ROUNDS; round++) {
        for (const endpoint of OVERPASS_ENDPOINTS) {
            try {
                const result = await fetchOverpass(endpoint, query, signal, budget, onBytes);
                used.add(endpoint);
                return result;
            } catch (error) {
                if (signal.aborted || permanent(error)) {
                    throw error;
                }
                lastError = error;
                // A server that ran out of time or memory on this tile will most likely again.
                if (error instanceof Error && error.message === 'overpass-incomplete' && ++incomplete >= 2) {
                    throw error;
                }
            }
        }
        if (round < TILE_ROUNDS - 1) {
            const retryAfter = (lastError as { retryAfter?: number } | null)?.retryAfter ?? 0;
            const limited = lastError instanceof Error && lastError.message === 'rate-limit';
            const ms = retryAfter > 0 ? retryAfter * 1000 : limited ? 20000 * (round + 1) : 3000 * 3 ** round;
            // Say why nothing moves: a pause on a weak link should not look like a hang.
            for (let left = Math.ceil(ms / 1000); left > 0; left--) {
                onWait(left);
                await sleep(1000, signal);
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error('download');
}

export interface DownloadOptions {
    id: string;
    name: string;
    bounds: Bounds;
    signal: AbortSignal;
    /** `part`: tiles finished so far and in total. For `wait`, `bytes` holds the seconds left. */
    onProgress: (phase: DownloadPhase, bytes: number, part?: { done: number; total: number }) => void;
}

export async function downloadArea(options: DownloadOptions): Promise<AreaPackage> {
    const bounds = resumeBounds(options.bounds);
    validateBounds(bounds);
    if (areaKm2(bounds) > MAX_AREA_KM2) {
        throw new Error('area-too-large');
    }
    if (!navigator.onLine) {
        throw new Error('offline');
    }
    const resuming = pending !== null && pending.bounds === bounds;
    // Continuing an interrupted download is not a new request burst: no pause needed.
    const wait = resuming ? 0 : secondsUntilNextDownload();
    if (wait > 0) {
        throw new Error(`rate-limit:${wait}`);
    }
    lastRequest = Date.now();
    if (!resuming) {
        dropPending();
        pending = { bounds, tiles: new Map(), endpoints: new Set(), expiry: null };
    }
    const kept = pending!;
    if (kept.expiry) {
        clearTimeout(kept.expiry);
        kept.expiry = null;
    }
    const tiles = tileBounds(bounds);
    const responses: OverpassResponse[] = [];
    let finishedBytes = 0;
    let requested = false;
    try {
        for (const [index, tile] of tiles.entries()) {
            options.signal.throwIfAborted();
            const query = overpassQuery(tile);
            let entry = kept.tiles.get(query);
            if (!entry) {
                if (requested) {
                    // Sequential and with a pause: the public Overpass servers are shared.
                    await sleep(TILE_PAUSE_MS, options.signal);
                }
                requested = true;
                entry = await fetchTile(query, options.signal, MAX_TOTAL_BYTES - finishedBytes,
                    (bytes) => options.onProgress('download', finishedBytes + bytes, { done: index, total: tiles.length }),
                    (seconds) => options.onProgress('wait', seconds, { done: index, total: tiles.length }),
                    kept.endpoints);
                kept.tiles.set(query, entry);
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
        const used = [...kept.endpoints];
        const pkg: AreaPackage = {
            format: 'as-tac-map',
            formatVersion: 1,
            id: options.id,
            name: options.name,
            bounds,
            dataTimestamp: raw.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
            source: `OpenStreetMap via Overpass API (${(used.length ? used : [OVERPASS_ENDPOINTS[0]]).join(', ')})`,
            attribution: '© OpenStreetMap contributors',
            license: 'ODbL 1.0',
            byteSize: new TextEncoder().encode(text).byteLength,
            sha256: await sha256Hex(text),
            featureCount: data.features.length,
            origin: 'download',
            data,
        };
        // Done: the tiles of this area are no longer needed in memory.
        dropPending();
        return pkg;
    } catch (error) {
        if (permanent(error)) {
            // Trying again would fail the same way: free the memory now.
            dropPending();
        } else if (pending === kept) {
            kept.expiry = setTimeout(() => {
                if (pending === kept) {
                    dropPending();
                }
            }, CACHE_MS);
        }
        throw error;
    }
}

export function slugId(name: string): string {
    const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'gebiet';
    return `${base}-${Date.now().toString(36)}`;
}
