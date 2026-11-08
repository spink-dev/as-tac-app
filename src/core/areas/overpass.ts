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

async function fetchOverpass(endpoint: string, query: string, signal: AbortSignal, onBytes: (bytes: number) => void): Promise<OverpassResponse> {
    const response = await fetch(endpoint, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
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
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
        total += value.length;
        onBytes(total);
        if (total > 300 * 1024 * 1024) {
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
    return JSON.parse(new TextDecoder().decode(bytes)) as OverpassResponse;
}

export interface DownloadOptions {
    id: string;
    name: string;
    bounds: Bounds;
    signal: AbortSignal;
    onProgress: (phase: DownloadPhase, bytes: number) => void;
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
    const query = overpassQuery(options.bounds);
    let raw: OverpassResponse | null = null;
    let lastError: unknown = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
            raw = await fetchOverpass(endpoint, query, options.signal, (bytes) => options.onProgress('download', bytes));
            break;
        } catch (error) {
            if (options.signal.aborted) {
                throw error;
            }
            lastError = error;
        }
    }
    if (!raw) {
        throw lastError instanceof Error ? lastError : new Error('download');
    }
    options.onProgress('convert', 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const data = toBasemap(raw);
    options.onProgress('verify', 0);
    const text = JSON.stringify(data);
    return {
        format: 'as-tac-map',
        formatVersion: 1,
        id: options.id,
        name: options.name,
        bounds: options.bounds,
        dataTimestamp: raw.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
        source: `OpenStreetMap via Overpass API (${OVERPASS_ENDPOINTS[0]})`,
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL 1.0',
        byteSize: text.length,
        sha256: await sha256Hex(text),
        featureCount: data.features.length,
        origin: 'download',
        data,
    };
}

export function slugId(name: string): string {
    const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'gebiet';
    return `${base}-${Date.now().toString(36)}`;
}
