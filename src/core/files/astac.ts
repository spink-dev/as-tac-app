import { db } from '../storage/db';
import { getAsset, isRenderableImage, putVerifiedAsset, sha256Hex } from '../storage/assets';
import { saveProject } from '../storage/projects';
import { ProjectSchema, type Project } from '../model/schema';
import { migrateProject } from '../model/migrations';
import { duplicateProject } from '../model/factory';
import { importAreaPackage } from '../areas/files';
import { hasArea } from '../areas/store';
import { AREA_FORMAT_VERSION, type AreaMeta, type AreaPackage } from '../areas/types';
import { convertOldProject, isOldProject } from '../legacy/astac';
import { convertTacMap, isTacMapProject, tacMapNeedsPlacement, type TacMapAsset, type TacMapPlacement } from '../legacy/tacmap';
import { APP_VERSION } from '../../version';
import { isZip, packZip, readJson, readZip } from './zip';

/**
 * `.astac` — AS-TAC 1.0 plan archive (ZIP):
 *   manifest.json   { format: 'as-tac', formatVersion: 2, project, assets[], area? } with SHA-256 for every file
 *   project.json    the plan (WGS84), validated with ProjectSchema on import
 *   assets/<sha256>.<ext>   image maps, team logos, attachments (passive MIME types only)
 *   area/<id>.astac-map.json   optional offline basemap (OSM, ODbL) so the receiver needs no download
 * as-tac 0.x wrote `format: 'as-tac', formatVersion: 1` (.astac.zip); TacMap wrote `format: 'tacmap'`.
 */
export const ARCHIVE_FORMAT_VERSION = 2;
const MAX_FILE = 128 * 1024 * 1024;

interface FileEntry {
    path: string;
    bytes: number;
    sha256: string;
}

interface Manifest {
    format: 'as-tac';
    formatVersion: 2;
    app: string;
    createdAt: string;
    projectFormatVersion: number;
    project: FileEntry;
    assets: (FileEntry & { hash: string; mime: string })[];
    area?: FileEntry & { id: string };
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt' };

export function assetRefs(project: Project): string[] {
    const refs = new Set<string>();
    project.images.forEach((image) => refs.add(image.asset));
    project.teams.forEach((team) => team.logoAsset && refs.add(team.logoAsset));
    project.elements.forEach((element) => element.attachments?.forEach((a) => refs.add(a.asset)));
    return [...refs];
}

const encoder = new TextEncoder();

/**
 * Own recorded paths stay on the device unless explicitly included (they are where the
 * user walked); everything else of the plan is exported.
 */
export async function exportAstac(source: Project, options: { includeArea: boolean; includeTracks?: boolean }): Promise<{ blob: Blob; missing: number }> {
    const project = options.includeTracks ? source : { ...source, tracks: [] };
    const parsed = ProjectSchema.safeParse(project);
    if (!parsed.success) {
        throw new Error('project-invalid');
    }
    const files: Record<string, Uint8Array> = {};
    const projectBytes = encoder.encode(JSON.stringify(project));
    files['project.json'] = projectBytes;
    const manifest: Manifest = {
        format: 'as-tac', formatVersion: 2, app: APP_VERSION, createdAt: new Date().toISOString(), projectFormatVersion: project.formatVersion,
        project: { path: 'project.json', bytes: projectBytes.length, sha256: await sha256Hex(projectBytes) },
        assets: [],
    };
    let missing = 0;
    for (const hash of assetRefs(project)) {
        const row = await getAsset(hash);
        if (!row) {
            // Leave it out (the receiver sees it as missing) instead of blocking the whole export.
            missing += 1;
            continue;
        }
        const bytes = new Uint8Array(await row.blob.arrayBuffer());
        if ((await sha256Hex(bytes)) !== hash) {
            throw new Error('asset-checksum');
        }
        const path = `assets/${hash}.${EXT[row.mime] ?? 'bin'}`;
        files[path] = bytes;
        manifest.assets.push({ path, hash, mime: row.mime, bytes: bytes.length, sha256: hash });
    }
    if (options.includeArea && project.areaId) {
        const row = await db.areas.get(project.areaId);
        if (row) {
            const pkg: AreaPackage = { ...row.meta, format: 'as-tac-map', formatVersion: AREA_FORMAT_VERSION, data: row.data };
            delete pkg.installedAt;
            const bytes = encoder.encode(JSON.stringify(pkg));
            const path = `area/${row.meta.id.replace(/[^A-Za-z0-9._-]/g, '_')}.astac-map.json`;
            files[path] = bytes;
            manifest.area = { id: row.meta.id, path, bytes: bytes.length, sha256: await sha256Hex(bytes) };
        }
    }
    files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 1));
    const zipped = packZip(files);
    const out = new ArrayBuffer(zipped.byteLength);
    new Uint8Array(out).set(zipped);
    return { blob: new Blob([out], { type: 'application/x-astac' }), missing };
}

export function astacFilename(project: Project): string {
    const base = project.name.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'plan';
    return `${base}.astac`;
}

/* ------------------------------------------------------------------ import */

export type ImportResult =
    | { kind: 'project'; project: Project; source: 'astac' | 'astac-legacy' | 'tacmap' | 'json-legacy' | 'link'; area?: AreaMeta; unaligned: string[]; skipped: number; missingAssets: number }
    | { kind: 'area'; area: AreaMeta };

/** TacMap maps without geo calibration need somewhere to land before the user aligns them. */
export type PlacementResolver = () => Promise<TacMapPlacement>;

async function verifyEntry(files: Map<string, Uint8Array>, entry: unknown): Promise<Uint8Array> {
    const e = entry as Partial<FileEntry> | null;
    if (!e || typeof e.path !== 'string' || typeof e.sha256 !== 'string') {
        throw new Error('archive-manifest');
    }
    const bytes = files.get(e.path);
    if (!bytes || bytes.length !== e.bytes || (await sha256Hex(bytes)) !== e.sha256) {
        throw new Error('archive-checksum');
    }
    return bytes;
}

const MAX_ASSET = 40 * 1024 * 1024;

/**
 * Store an archive asset under its verified hash. The asset store keeps images only when the bytes
 * really are an image within the decode limits; anything else is kept inert.
 */
async function storeAsset(hash: string, bytes: Uint8Array, declaredMime: unknown): Promise<string> {
    if (bytes.length > MAX_ASSET) {
        throw new Error('archive-too-large');
    }
    await putVerifiedAsset(hash, bytes, typeof declaredMime === 'string' ? declaredMime : '');
    return (await getAsset(hash))?.mime ?? 'application/octet-stream';
}

const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;

/** Re-exported for importers of this module; the migrations live in model/migrations.ts. */
export { migrateProject };

async function readAstacV2(files: Map<string, Uint8Array>, manifest: Record<string, unknown>, signal?: AbortSignal): Promise<ImportResult> {
    const project = migrateProject(decode(await verifyEntry(files, manifest.project)));
    const declared = Array.isArray(manifest.assets) ? manifest.assets as Manifest['assets'] : [];
    const needed = new Set(assetRefs(project));
    for (const entry of declared) {
        signal?.throwIfAborted();
        if (!entry || typeof entry.hash !== 'string' || !needed.has(entry.hash)) {
            continue;
        }
        const bytes = await verifyEntry(files, entry);
        if ((await sha256Hex(bytes)) !== entry.hash) {
            throw new Error('archive-checksum');
        }
        await storeAsset(entry.hash, bytes, entry.mime);
        needed.delete(entry.hash);
    }
    let area: AreaMeta | undefined;
    if (manifest.area) {
        signal?.throwIfAborted();
        const pkg = decode(await verifyEntry(files, manifest.area)) as { id?: unknown };
        area = await importAreaPackage(pkg);
        // The plan follows its area to wherever it now lives (reused or newly stored id).
        if (project.areaId && project.areaId === pkg.id) {
            project.areaId = area.id;
        }
    }
    return { kind: 'project', project, source: 'astac', area, unaligned: [], skipped: 0, missingAssets: 0 };
}

/** as-tac 0.6 `.astac.zip`: fixed files, plan in the 0.x schema, map package included. */
async function readAstacV1(files: Map<string, Uint8Array>, manifest: Record<string, unknown>, signal?: AbortSignal): Promise<ImportResult> {
    const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
    const covered = new Set<string>();
    for (const resource of resources) {
        await verifyEntry(files, resource);
        covered.add((resource as FileEntry).path);
    }
    // Everything in the package must be covered by the manifest (as 0.6 required).
    for (const name of files.keys()) {
        if (name !== 'manifest.json' && !covered.has(name)) {
            throw new Error('archive-checksum');
        }
    }
    if (!covered.has('project.json')) {
        throw new Error('archive-checksum');
    }
    const old = decode(files.get('project.json') ?? new Uint8Array());
    if (!isOldProject(old)) {
        throw new Error('project-invalid');
    }
    signal?.throwIfAborted();
    let area: AreaMeta | undefined;
    if (files.has('maps/area.json')) {
        area = await importAreaPackage(decode(files.get('maps/area.json')!));
    }
    const project = migrateProject(convertOldProject(old, area?.id ?? null));
    return { kind: 'project', project, source: 'astac-legacy', area, unaligned: [], skipped: 0, missingAssets: 0 };
}

/** Hashes a TacMap project really uses (map images, inset images, team logos). */
function tacMapRefs(raw: unknown): Set<string> {
    const refs = new Set<string>();
    const add = (value: unknown) => typeof value === 'string' && refs.add(value.toLowerCase());
    const project = raw as { maps?: { image?: unknown; overlays?: { image?: unknown }[] }[]; teams?: { logoAsset?: unknown }[] };
    for (const map of Array.isArray(project.maps) ? project.maps : []) {
        add(map?.image);
        for (const overlay of Array.isArray(map?.overlays) ? map.overlays : []) {
            add(overlay?.image);
        }
    }
    for (const team of Array.isArray(project.teams) ? project.teams : []) {
        add(team?.logoAsset);
    }
    return refs;
}

async function readTacMap(files: Map<string, Uint8Array>, manifest: Record<string, unknown>, place: PlacementResolver, signal?: AbortSignal): Promise<ImportResult> {
    const projectBytes = files.get('project.json');
    // TacMap always writes a checksum over the exact project.json text.
    if (!projectBytes || typeof manifest.checksum !== 'string') {
        throw new Error('archive-checksum');
    }
    if (manifest.checksum.toLowerCase() !== await sha256Hex(projectBytes)) {
        throw new Error('archive-checksum');
    }
    const raw = decode(projectBytes);
    if (!isTacMapProject(raw)) {
        throw new Error('project-invalid');
    }
    const used = tacMapRefs(raw);
    const assets = new Map<string, TacMapAsset>();
    const declared = Array.isArray(manifest.assets) ? manifest.assets as { hash?: unknown; mime?: unknown }[] : [];
    for (const entry of declared) {
        signal?.throwIfAborted();
        const hash = typeof entry?.hash === 'string' ? entry.hash.toLowerCase() : '';
        if (!/^[a-f0-9]{64}$/.test(hash) || !used.has(hash) || assets.has(hash)) {
            continue;
        }
        const path = [...files.keys()].find((name) => name.toLowerCase().startsWith(`assets/${hash}.`));
        const bytes = path ? files.get(path) : undefined;
        if (!bytes || (await sha256Hex(bytes)) !== hash) {
            continue;
        }
        const mime = await storeAsset(hash, bytes, entry.mime);
        assets.set(hash, { hash, mime });
    }
    signal?.throwIfAborted();
    // Only ask where to put the map when some map has no usable geo tie points.
    const placement = tacMapNeedsPlacement(raw) ? await place() : { center: [0, 0] as [number, number], widthM: 1000 };
    signal?.throwIfAborted();
    const result = convertTacMap(raw, assets, placement);
    const project = migrateProject(result.project);
    return { kind: 'project', project, source: 'tacmap', unaligned: result.unaligned, skipped: result.skipped, missingAssets: 0 };
}

/**
 * What of a plan's pictures this device can't show: image maps and logos that are missing or were
 * stored inert (not a real image, too large to decode), and missing attachments. Logos that can't
 * be shown fall back to the team symbol instead of an empty marker.
 */
export async function checkPlanAssets(project: Project): Promise<{ project: Project; unusable: number }> {
    let unusable = 0;
    for (const image of project.images) {
        if (!isRenderableImage(await getAsset(image.asset))) {
            unusable += 1;
        }
    }
    const teams = [];
    for (const team of project.teams) {
        if (team.logoAsset && !isRenderableImage(await getAsset(team.logoAsset))) {
            unusable += 1;
            const copy = { ...team, displayMode: team.displayMode === 'logo' ? 'icon' as const : team.displayMode };
            delete copy.logoAsset;
            teams.push(copy);
        } else {
            teams.push(team);
        }
    }
    const attachments = new Set(project.elements.flatMap((element) => element.attachments?.map((a) => a.asset) ?? []));
    for (const hash of attachments) {
        if (!(await getAsset(hash))) {
            unusable += 1;
        }
    }
    return { project: { ...project, teams }, unusable };
}

/**
 * Read any supported file: `.astac`, `.tacmap`, as-tac 0.x `.astac.zip` / plan JSON, or a
 * `.astac-map.json` offline area. Nothing is stored until it is fully verified, except
 * content-addressed assets and areas (harmless duplicates at worst).
 * Unusable pictures are counted in `missingAssets` (see `checkPlanAssets`).
 */
export async function readImportFile(file: Blob, place: PlacementResolver, signal?: AbortSignal): Promise<ImportResult> {
    const result = await readAnyFile(file, place, signal);
    if (result.kind !== 'project') {
        return result;
    }
    const checked = await checkPlanAssets(result.project);
    return { ...result, project: checked.project, missingAssets: checked.unusable };
}

async function readAnyFile(file: Blob, place: PlacementResolver, signal?: AbortSignal): Promise<ImportResult> {
    if (file.size > MAX_FILE) {
        throw new Error('archive-too-large');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes)) {
        const files = await readZip(bytes, undefined, signal);
        const manifest = readJson(files, 'manifest.json') as Record<string, unknown>;
        if (manifest?.format === 'as-tac' && manifest.formatVersion === 2) {
            return readAstacV2(files, manifest, signal);
        }
        if (manifest?.format === 'as-tac' && manifest.formatVersion === 1) {
            return readAstacV1(files, manifest, signal);
        }
        if (manifest?.format === 'tacmap') {
            return readTacMap(files, manifest, place, signal);
        }
        if (manifest?.format === 'as-tac' && typeof manifest.formatVersion === 'number' && manifest.formatVersion > 2) {
            throw new Error('project-newer');
        }
        throw new Error('format-unknown');
    }
    let json: unknown;
    try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw new Error('format-unknown');
    }
    const value = json as { format?: unknown };
    if (value?.format === 'as-tac-map') {
        return { kind: 'area', area: await importAreaPackage(json) };
    }
    if (isOldProject(json)) {
        const areaId = typeof (json as { mapPackageId?: unknown }).mapPackageId === 'string' && await hasArea((json as { mapPackageId: string }).mapPackageId)
            ? (json as { mapPackageId: string }).mapPackageId : null;
        return { kind: 'project', project: migrateProject(convertOldProject(json, areaId)), source: 'json-legacy', unaligned: [], skipped: 0, missingAssets: 0 };
    }
    throw new Error('format-unknown');
}

/** Store an imported plan. An existing plan with the same id is never overwritten: the import becomes a copy. */
export async function storeImported(project: Project, copySuffix: string): Promise<Project> {
    const exists = Boolean(await db.projects.get(project.id));
    const stored = exists ? duplicateProject(project, `${project.name.slice(0, 100)} ${copySuffix}`.trim()) : project;
    await saveProject(stored);
    return stored;
}
