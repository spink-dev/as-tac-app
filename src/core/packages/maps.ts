import osmtogeojson from 'osmtogeojson';
import presets from '../../config/maps.json' with { type: 'json' };
import { ProjectDatabase } from '../projects/database';

export const MAX_BYTES = 25 * 1024 * 1024;
export const ENDPOINT = 'https://overpass-api.de/api/interpreter';
export type Bounds = [number, number, number, number];
export interface MapPackage {
    format: 'as-tac-map';
    formatVersion: 1;
    id: string;
    name: string;
    bounds: Bounds;
    dataTimestamp: string;
    source: string;
    attribution: '© OpenStreetMap contributors';
    license: 'ODbL 1.0';
    byteSize: number;
    sha256: string;
    data: GeoJSON.FeatureCollection;
}
export function validateBounds(bounds: unknown, prepared = false): asserts bounds is Bounds {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
        || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -85 || bounds[3] > 85
        || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]
        || bounds[2] - bounds[0] > (prepared ? 0.2 : 0.08) || bounds[3] - bounds[1] > (prepared ? 0.1 : 0.05)) {
        throw new Error('bounds');
    }
}
export function validateData(data: unknown): asserts data is GeoJSON.FeatureCollection {
    const collection = data as GeoJSON.FeatureCollection;
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features) || collection.features.length > 100_000) {
        throw new Error('format');
    }
    let vertices = 0;
    function coordinates(value: any, depth: number) {
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error('format');
        }
        if (depth === 0) {
            if (value.length !== 2 || !value.every(Number.isFinite) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90 || ++vertices > 750_000) {
                throw new Error('format');
            }
        } else {
            value.forEach((part) => coordinates(part, depth - 1));
        }
    }
    for (const feature of collection.features) {
        const depths = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
        if (!feature || feature.type !== 'Feature' || !feature.geometry || !Object.hasOwn(depths, feature.geometry.type)) {
            throw new Error('format');
        }
        coordinates((feature.geometry as any).coordinates, depths[feature.geometry.type as keyof typeof depths]);
        if (!feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties)
            || Object.entries(feature.properties).some(([key, value]) => key.length > 200 || (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) || (typeof value === 'string' && value.length > 10_000))) {
            throw new Error('format');
        }
    }
}
export async function hash(data: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyPackage(value: unknown): Promise<MapPackage> {
    const pkg = value as MapPackage;
    if (!pkg || pkg.format !== 'as-tac-map' || pkg.formatVersion !== 1 || typeof pkg.id !== 'string'
        || (!/^local-[0-9a-f-]{36}$/.test(pkg.id) && !presets.some((preset) => preset.id === pkg.id))
        || typeof pkg.name !== 'string' || !pkg.name.trim() || pkg.name.length > 120
        || pkg.license !== 'ODbL 1.0' || pkg.attribution !== '© OpenStreetMap contributors'
        || typeof pkg.source !== 'string' || pkg.source.length > 500
        || typeof pkg.dataTimestamp !== 'string' || !Number.isFinite(Date.parse(pkg.dataTimestamp))) {
        throw new Error('format');
    }
    validateBounds(pkg.bounds, true);
    validateData(pkg.data);
    const data = JSON.stringify(pkg.data);
    const bytes = new TextEncoder().encode(data).length;
    if (bytes > MAX_BYTES || bytes !== pkg.byteSize || await hash(data) !== pkg.sha256) {
        throw new Error('hash');
    }
    // Only the documented fields enter storage; imported URLs are metadata, never requests.
    return { format: pkg.format, formatVersion: 1, id: pkg.id, name: pkg.name, bounds: pkg.bounds,
        dataTimestamp: pkg.dataTimestamp, source: pkg.source, attribution: pkg.attribution,
        license: pkg.license, byteSize: bytes, sha256: pkg.sha256, data: pkg.data };
}
export async function limitedText(response: Response, signal: AbortSignal, progress: (bytes: number) => void): Promise<string> {
    if (!response.ok || !response.body) {
        throw new Error(`http-${response.status}`);
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        throw new Error('size');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
        while (true) {
            signal.throwIfAborted();
            const part = await reader.read();
            if (part.done) {
                break;
            }
            bytes += part.value.byteLength;
            if (bytes > MAX_BYTES) {
                throw new Error('size');
            }
            progress(bytes);
            text += decoder.decode(part.value, { stream: true });
        }
        return text + decoder.decode();
    } finally {
        await reader.cancel().catch(() => {
            // The transport may already have been aborted.
        });
    }
}
export async function loadMap(id: string, signal: AbortSignal): Promise<MapPackage> {
    const preset = presets.find((item) => item.id === id);
    if (preset) {
        const response = await fetch(`/maps/${id}.json`, { signal });
        if (!response.ok) {
            throw new Error('missing');
        }
        const metadata = await response.json();
        const raw = await limitedText(await fetch(`/maps/${id}.geojson`, { signal }), signal, () => {
            // Presets do not need a download progress UI.
        });
        return verifyPackage({ ...metadata, format: 'as-tac-map', formatVersion: 1, data: JSON.parse(raw) });
    }
    const db = await ProjectDatabase.open();
    try {
        return await verifyPackage(await db.loadMap(id));
    } finally {
        db.close();
    }
}
export async function installMap(value: unknown, signal: AbortSignal): Promise<MapPackage> {
    const pkg = await verifyPackage(value);
    // Imports always create an independent immutable package; never overwrite a project's map.
    pkg.id = `local-${crypto.randomUUID()}`;
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < pkg.byteSize * 2 + 1024 * 1024) {
        throw new Error('quota');
    }
    signal.throwIfAborted();
    const db = await ProjectDatabase.open();
    try {
        await db.installMap(pkg, signal);
        return pkg;
    } finally {
        db.close();
    }
}
export async function downloadMap(name: string, bounds: Bounds, signal: AbortSignal, progress: (bytes: number) => void): Promise<MapPackage> {
    validateBounds(bounds);
    const bbox = [bounds[1], bounds[0], bounds[3], bounds[2]].join(',');
    const query = `[out:json][timeout:60][maxsize:33554432];(way[highway](${bbox});way[building](${bbox});way[landuse](${bbox});way[natural](${bbox});way[waterway](${bbox});relation[type=multipolygon][landuse](${bbox});relation[type=multipolygon][natural](${bbox});node[name][tourism](${bbox});node[name][amenity](${bbox});node[natural=peak](${bbox}););out body;>;out skel qt;`;
    const combined = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
    const response = await fetch(ENDPOINT, { method: 'POST', body: new URLSearchParams({ data: query }), signal: combined });
    const raw = JSON.parse(await limitedText(response, combined, progress));
    if (!Array.isArray(raw.elements) || raw.elements.length > 300_000 || raw.remark) {
        throw new Error('provider');
    }
    signal.throwIfAborted();
    const data = osmtogeojson(raw, { flatProperties: true });
    const json = JSON.stringify(data);
    return installMap({ format: 'as-tac-map', formatVersion: 1, id: `local-${crypto.randomUUID()}`, name,
        bounds, dataTimestamp: raw.osm3s?.timestamp_osm_base, source: ENDPOINT,
        attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0',
        byteSize: new TextEncoder().encode(json).length, sha256: await hash(json), data }, signal);
}
