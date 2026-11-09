// Prepared airsoft fields: offline OSM basemaps for the catalog in src/config/maps.json.
//
//   npm run map:build                         fetch every field except Mahlwinkel from Overpass (needs network)
//   npm run map:build -- fr-baerenkopf ...    fetch only these fields
//   npm run map:build -- --from raw.json[.gz] convert Overpass responses saved elsewhere
//
// `--from` reads {"fields":[{"id","bounds","endpoint","response"}]}, with `response` the untouched
// Overpass JSON of `overpassQuery(bounds)`; the bounds in that file replace the catalog's.
// The conversion is the app's own (`toBasemap` in src/core/areas/overpass.ts), as for an area
// downloaded in the app (Mahlwinkel's file predates it and stays as it is until it is rebuilt).
//
// Each file is named after its content (`public/maps/<country>/<name>.<sha256:8>.geojson`): an app
// version knows the hash of exactly the files it was built with, so a refreshed field must never
// replace a file an older version still downloads. Previous files are therefore kept; remove them
// only once no supported version names them. `maps/mahlwinkel.{json,geojson}` stay frozen for
// apps up to 1.0.0-alpha.2, which read that manifest. Nothing is written unless every field built.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'vite';

const CATALOG = 'src/config/maps.json';
const MAX_RAW_BYTES = 512 * 1024 * 1024;
const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const fromFile = fromIndex >= 0 ? args[fromIndex + 1] : null;
if (fromIndex >= 0 && (!fromFile || fromFile.startsWith('--'))) {
    console.error('--from braucht eine Datei');
    process.exit(2);
}
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

    /** @type {Map<string, { bounds: number[], endpoint: string, response: any }>} */
    const responses = new Map();
    if (fromFile) {
        const bytes = await readFile(fromFile);
        const text = (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: MAX_RAW_BYTES }) : bytes).toString('utf8');
        for (const entry of JSON.parse(text).fields ?? []) {
            if (typeof entry.endpoint !== 'string' || !entry.endpoint.startsWith('https://')) {
                throw new Error(`${entry.id}: Quelle (endpoint) fehlt in ${fromFile}`);
            }
            responses.set(entry.id, { bounds: entry.bounds, endpoint: entry.endpoint, response: entry.response });
        }
    }
    const unknown = only.filter((id) => !catalog.fields.some((field) => field.id === id));
    if (unknown.length) {
        throw new Error(`Nicht im Katalog: ${unknown.join(', ')}`);
    }
    const wanted = catalog.fields.filter((field) => (only.length ? only.includes(field.id) : fromFile ? responses.has(field.id) : field.id !== 'mahlwinkel'));
    if (wanted.length === 0) {
        throw new Error('Keine Felder zu bauen');
    }

    // Build everything first; files and catalog are written only when all fields succeeded.
    const results = [];
    for (const [index, field] of wanted.entries()) {
        if (!/^[a-z0-9-]{1,60}$/.test(field.id) || !/^[A-Z]{2}$/.test(field.country)) {
            throw new Error(`${field.id}: id oder Land ungültig`);
        }
        let saved = responses.get(field.id);
        if (!saved) {
            if (fromFile) {
                throw new Error(`${field.id}: nicht in ${fromFile}`);
            }
            if (index > 0) {
                // Public Overpass servers ask for pauses between queries.
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }
            saved = await fetchField(field.bounds, overpassQuery, OVERPASS_ENDPOINTS);
        }
        validateBounds(saved.bounds);
        const data = toBasemap(saved.response);
        const bytes = Buffer.from(JSON.stringify(data));
        if (data.features.length === 0 || data.features.length > MAX_FEATURES || bytes.byteLength > MAX_AREA_BYTES) {
            throw new Error(`${field.id}: ${data.features.length} Objekte, ${bytes.byteLength} Bytes`);
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const country = field.country.toLowerCase();
        const name = field.id.startsWith(`${country}-`) ? field.id.slice(country.length + 1) : field.id;
        results.push({
            field,
            bytes,
            update: {
                file: `/maps/${country}/${name}.${sha256.slice(0, 8)}.geojson`,
                bounds: saved.bounds,
                bytes: bytes.byteLength,
                featureCount: data.features.length,
                sha256,
                dataTimestamp: saved.response.osm3s?.timestamp_osm_base ?? '',
                source: saved.endpoint,
            },
        });
    }
    for (const { field, bytes, update } of results) {
        const path = `public${update.file}`;
        await mkdir(dirname(path), { recursive: true });
        if (!existsSync(path)) {
            await writeFile(path, bytes);
        }
        if (field.file !== update.file) {
            console.log(`${field.id}: ${field.file} bleibt für ältere Versionen liegen`);
        }
        Object.assign(field, update);
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
