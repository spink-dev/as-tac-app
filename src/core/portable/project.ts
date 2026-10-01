import { version } from '../../../package.json';
import { validateProject, duplicateProject, type Project } from '../projects/model';
import { verifyPackage, type MapPackage } from '../packages/maps';
import { digest, encode, pack, unpack, PATHS } from './archive';

// The app's built-in vector renderer uses system fonts and no remote assets.
const renderer = { id: 'as-tac-vector', version: 1, fonts: 'system', externalResources: [] };
export async function exportProject(project: Project, map: MapPackage, revision: number) {
    validateProject(project);
    await verifyPackage(map);
    if (project.mapPackageId !== map.id) {
        throw new Error('missing');
    }
    const files: Record<string, Uint8Array> = {
        'project.json': encode(project), 'maps/area.json': encode(map), 'credits/renderer.json': encode(renderer),
    };
    for (const path of ['ODbL-1.0.txt', 'CREDITS.md']) {
        const response = await fetch(`/licenses/${path}`);
        if (!response.ok) {
            throw new Error('missing');
        }
        files[`credits/${path}`] = new Uint8Array(await response.arrayBuffer());
    }
    const resources = await Promise.all(Object.entries(files).map(async ([path, bytes]) => ({ path, bytes: bytes.length, sha256: await digest(bytes) })));
    files['manifest.json'] = encode({ format: 'as-tac', formatVersion: 1, appVersion: version, createdAt: new Date().toISOString(), projectId: project.id, planRevision: Math.max(1, revision), resources });
    return pack(files);
}
export async function importProject(bytes: Uint8Array, signal: AbortSignal) {
    const files = await unpack(bytes, signal);
    const manifest = jsonManifest(files['manifest.json']);
    if (manifest.resources.length !== PATHS.length - 1) {
        throw new Error('archive');
    }
    const seen = new Set<string>();
    for (const resource of manifest.resources) {
        if (!resource || typeof resource.path !== 'string' || resource.path === 'manifest.json' || !Object.hasOwn(files, resource.path) || seen.has(resource.path)
            || resource.bytes !== files[resource.path].length || resource.sha256 !== await digest(files[resource.path])) {
            throw new Error('hash');
        }
        seen.add(resource.path);
        signal.throwIfAborted();
    }
    const parse = (path: string) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files[path]));
    if (JSON.stringify(parse('credits/renderer.json')) !== JSON.stringify(renderer)) {
        throw new Error('renderer');
    }
    const original = parse('project.json');
    validateProject(original);
    const map = await verifyPackage(parse('maps/area.json'));
    if (manifest.projectId !== original.id || original.mapPackageId !== map.id) {
        throw new Error('missing');
    }
    const project = duplicateProject(original, original.name);
    map.id = `local-${crypto.randomUUID()}`;
    project.mapPackageId = map.id;
    return { project, map };
}
function jsonManifest(bytes: Uint8Array) {
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!manifest || manifest.format !== 'as-tac' || manifest.formatVersion !== 1 || typeof manifest.appVersion !== 'string'
        || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))
        || !Number.isSafeInteger(manifest.planRevision) || manifest.planRevision < 1 || !Array.isArray(manifest.resources)) {
        throw new Error('archive');
    }
    return manifest;
}
