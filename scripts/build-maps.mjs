// Prepared airsoft fields: offline OSM basemaps for the catalog in src/config/maps.json.
//
//   npm run map:build                         fetch every field from Overpass (needs network)
//   npm run map:build -- fr-baerenkopf ...    fetch only these fields
//   npm run map:build -- --from raw.json[.gz] convert Overpass responses saved elsewhere
//
// `--from` reads {"fields":[{"id","bounds","endpoint","response"}]}, with `response` the untouched
// Overpass JSON of `overpassQuery(bounds)`; the bounds in that file replace the catalog's.
// The conversion is the app's own (src/core/areas/overpass.ts), so a prepared field looks exactly
// like a field downloaded in the app. Writes public/maps/<country>/<name>.geojson and stores
// size, feature count, SHA-256, data time and source in the catalog; the app checks every
// download against that hash. Mahlwinkel keeps its file and is only refreshed when named.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'vite';

const CATALOG = 'src/config/maps.json';
const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const fromFile = fromIndex >= 0 ? args[fromIndex + 1] : null;
const only = args.filter((arg, index) => !arg.startsWith('--') && (fromIndex < 0 || index !== fromIndex + 1));

const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false },
});
try {
    const { toBasemap, overpassQuery, OVERPASS_ENDPOINTS } = await server.ssrLoadModule('/src/core/areas/overpass.ts');
    const { MAX_AREA_BYTES, MAX_FEATURES, validateBounds } = await server.ssrLoadModule('/src/core/areas/store.ts');
    const catalog = JSON.parse(await readFile(CATALOG, 'utf8'));

    /** @type {Map<string, { bounds: number[], endpoint: string, response: unknown }>} */
    const responses = new Map();
    if (fromFile) {
        const bytes = await readFile(fromFile);
        const saved = JSON.parse((bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes).toString('utf8'));
        for (const entry of saved.fields) {
            responses.set(entry.id, { bounds: entry.bounds, endpoint: entry.endpoint, response: entry.response });
        }
    }
    const wanted = catalog.fields.filter((field) => (only.length ? only.includes(field.id) : fromFile ? responses.has(field.id) : field.id !== 'mahlwinkel'));
    const unknown = only.filter((id) => !catalog.fields.some((field) => field.id === id));
    if (unknown.length) {
        throw new Error(`Nicht im Katalog: ${unknown.join(', ')}`);
    }

    for (const field of wanted) {
        if (!/^[a-z0-9-]{1,60}$/.test(field.id) || !/^[A-Z]{2}$/.test(field.country) || !/^\/maps\/[a-z0-9/-]+\.geojson$/.test(field.file)) {
            throw new Error(`${field.id}: id, Land oder Datei ungültig`);
        }
        let saved = responses.get(field.id);
        if (!saved) {
            if (fromFile) {
                throw new Error(`${field.id}: nicht in ${fromFile}`);
            }
            saved = await fetchField(field.bounds, overpassQuery, OVERPASS_ENDPOINTS);
        }
        validateBounds(saved.bounds);
        const data = toBasemap(saved.response);
        const text = JSON.stringify(data);
        if (data.features.length === 0 || data.features.length > MAX_FEATURES || Buffer.byteLength(text) > MAX_AREA_BYTES) {
            throw new Error(`${field.id}: ${data.features.length} Objekte, ${Buffer.byteLength(text)} Bytes`);
        }
        const path = `public${field.file}`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, text);
        const written = await readFile(path);
        Object.assign(field, {
            bounds: saved.bounds,
            bytes: written.byteLength,
            featureCount: data.features.length,
            sha256: createHash('sha256').update(written).digest('hex'),
            dataTimestamp: saved.response.osm3s?.timestamp_osm_base ?? '',
            source: saved.endpoint,
        });
        console.log(`${field.id.padEnd(18)} ${String(field.featureCount).padStart(6)} Objekte ${(field.bytes / 1024).toFixed(0).padStart(6)} KB  ${field.dataTimestamp}`);
    }
    await writeFile(CATALOG, `${JSON.stringify(catalog, null, 4)}\n`);
} finally {
    await server.close();
}

async function fetchField(bounds, overpassQuery, endpoints) {
    let lastError = null;
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'User-Agent': 'as-tac-map-build/1.0 (prepared airsoft fields)' },
                body: new URLSearchParams({ data: overpassQuery(bounds) }),
                signal: AbortSignal.timeout(180000),
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const json = await response.json();
            if (!Array.isArray(json.elements)) {
                throw new Error('keine Overpass-Antwort');
            }
            return { bounds, endpoint, response: json };
        } catch (error) {
            lastError = new Error(`${endpoint}: ${error instanceof Error ? error.message : error}`);
            console.warn(lastError.message);
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw lastError ?? new Error('Overpass nicht erreichbar');
}
