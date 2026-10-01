import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import osmtogeojson from 'osmtogeojson';

// A small, reproducible demo area, not an event map. No tile-server downloads.
const id = process.argv[2] ?? 'benglen';
const areas = JSON.parse(await readFile('src/config/maps.json', 'utf8'));
const preset = areas.find((area) => area.id === id);
const bounds = process.env.MAP_BOUNDS ? JSON.parse(process.env.MAP_BOUNDS) : preset?.bounds;
if (!/^[a-z0-9-]+$/.test(id) || !Array.isArray(bounds) || bounds.length !== 4
    || !bounds.every(Number.isFinite) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]
    || bounds[2] - bounds[0] > (preset ? 0.2 : 0.08) || bounds[3] - bounds[1] > (preset ? 0.1 : 0.05)
    || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -85 || bounds[3] > 85) {
    throw new Error('Gültige kleine WGS84-Bounds erforderlich: [west,south,east,north].');
}
const endpoint = 'https://overpass-api.de/api/interpreter';
const bbox = [bounds[1], bounds[0], bounds[3], bounds[2]].join(',');
const query = `[out:json][timeout:90];(way[highway](${bbox});way[building](${bbox});way[landuse](${bbox});way[natural](${bbox});way[waterway](${bbox});relation[type=multipolygon][landuse](${bbox});relation[type=multipolygon][natural](${bbox});node[name][tourism](${bbox});node[name][amenity](${bbox});node[natural=peak](${bbox}););out body;>;out skel qt;`;
const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'User-Agent': 'as-tac-offline-map/0.1 (local mobile feasibility test)' },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(120000),
});
if (!response.ok) {
    throw new Error(`Overpass HTTP ${response.status}`);
}
const raw = await response.json();
if (raw.remark || !Array.isArray(raw.elements)) {
    throw new Error('Unvollständige Overpass-Antwort');
}
const geojson = osmtogeojson(raw, { flatProperties: true });
// Keep display tags and OSM IDs; discard contact/address metadata from the offline basemap.
const tags = new Set(['name', 'highway', 'building', 'landuse', 'natural', 'waterway', 'amenity', 'tourism', 'place', 'leisure', 'railway']);
for (const feature of geojson.features) {
    feature.properties = Object.fromEntries(Object.entries(feature.properties ?? {}).filter(([key]) => tags.has(key)));
}
if (geojson.features.length > 100000) {
    throw new Error('Kartenpaket überschreitet 100000 Objekte');
}
const data = JSON.stringify(geojson);
if (Buffer.byteLength(data) > 25 * 1024 * 1024) {
    throw new Error('Kartenpaket überschreitet 25 MiB');
}
const manifest = {
    id,
    name: process.env.MAP_NAME ?? preset?.name ?? id,
    bounds,
    dataTimestamp: raw.osm3s.timestamp_osm_base,
    source: endpoint,
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL 1.0',
    file: `/maps/${id}.geojson`,
    byteSize: Buffer.byteLength(data),
    sha256: createHash('sha256').update(data).digest('hex'),
    featureCount: geojson.features.length,
};
await writeFile(`public/maps/${id}.geojson`, data);
await writeFile(`public/maps/${id}.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest);
