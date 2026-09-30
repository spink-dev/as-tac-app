import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function inventory(directory, prefix = '') {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            files.push(...await inventory(`${directory}/${entry.name}`, path));
        } else if (!['sw.js', 'offline-manifest.json'].includes(entry.name)) {
            const data = await readFile(`${directory}/${entry.name}`);
            files.push({ url: path === '/index.html' ? '/' : path, bytes: data.length,
                sha256: createHash('sha256').update(data).digest('hex') });
        }
    }
    return files.sort((a, b) => a.url.localeCompare(b.url));
}
await copyFile('CREDITS.md', 'dist/licenses/CREDITS.md');
await readFile('dist/licenses/ODbL-1.0.txt');
await readFile('dist/licenses/dependencies.txt');
const areas = JSON.parse(await readFile('src/config/maps.json', 'utf8'));
for (const { id, name, bounds } of areas) {
    const map = JSON.parse(await readFile(`dist/maps/${id}.json`, 'utf8'));
    const data = await readFile(`dist/maps/${id}.geojson`);
    if (map.id !== id || map.name !== name || JSON.stringify(map.bounds) !== JSON.stringify(bounds)
        || data.length !== map.byteSize || createHash('sha256').update(data).digest('hex') !== map.sha256) {
        throw new Error(`Kartenmanifest und Daten stimmen nicht überein: ${id}`);
    }
}
const resources = await inventory('dist');
const worker = await readFile('src/core/service-worker.js', 'utf8');
const version = createHash('sha256').update(JSON.stringify(resources)).update(worker).digest('hex').slice(0, 16);
const manifest = { version, resources, byteSize: resources.reduce((sum, r) => sum + r.bytes, 0) };
await writeFile('dist/offline-manifest.json', JSON.stringify(manifest, null, 2));
await writeFile('dist/sw.js', `const MANIFEST = ${JSON.stringify(manifest)};\n${worker}`);
console.log(`Offline build ${version}: ${resources.length} resources, ${manifest.byteSize} bytes`);
