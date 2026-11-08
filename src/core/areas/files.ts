import { db } from '../storage/db';
import { saveArea, verifyArea } from './store';
import type { AreaMeta, AreaPackage } from './types';

/** `.astac-map.json` — the offline basemap as a standalone file (compatible with as-tac 0.6). */
export async function exportAreaFile(id: string): Promise<{ blob: Blob; filename: string }> {
    const row = await db.areas.get(id);
    if (!row) {
        throw new Error('area-unknown');
    }
    const pkg: AreaPackage = { ...row.meta, format: 'as-tac-map', formatVersion: 1, data: row.data };
    delete pkg.installedAt;
    const blob = new Blob([JSON.stringify(pkg)], { type: 'application/json' });
    return { blob, filename: `${id}.astac-map.json` };
}

/** Import an area package. Same id and hash: reuse. Same id, different data: keep both. */
export async function importAreaPackage(raw: unknown): Promise<AreaMeta> {
    const pkg = await verifyArea(raw);
    const existing = await db.areas.get(pkg.id);
    if (existing && existing.meta.sha256 === pkg.sha256) {
        return existing.meta;
    }
    const id = existing ? `${pkg.id}-${Date.now().toString(36)}` : pkg.id;
    return saveArea({ ...pkg, id, origin: 'import' });
}
