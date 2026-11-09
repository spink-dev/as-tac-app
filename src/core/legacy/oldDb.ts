import { convertOldProject, isOldProject, type OldProject } from './astac';
import { ProjectSchema } from '../model/schema';
import { saveArea, verifyArea } from '../areas/store';
import { sanitizeArea } from '../areas/files';
import { db, kvGet, kvSet } from '../storage/db';
import { saveProject } from '../storage/projects';
import { BUNDLED_AREAS } from '../areas/store';

/**
 * as-tac ≤ 0.6 kept plans in the IndexedDB database `as-tac-projects` on the same origin
 * (test-prod.as-tac.dev / test.as-tac.dev). Offer to bring them over; never delete the original.
 */
const OLD_DB = 'as-tac-projects';

async function oldDatabaseExists(): Promise<boolean> {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
        return false;
    }
    const list = await indexedDB.databases().catch(() => []);
    return list.some((entry) => entry.name === OLD_DB);
}

function readAll(database: IDBDatabase, store: string): Promise<unknown[]> {
    return new Promise((resolve) => {
        if (!database.objectStoreNames.contains(store)) {
            resolve([]);
            return;
        }
        const request = database.transaction(store, 'readonly').objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => resolve([]);
    });
}

async function openOld(): Promise<IDBDatabase | null> {
    if (!(await oldDatabaseExists())) {
        return null;
    }
    return new Promise((resolve) => {
        const request = indexedDB.open(OLD_DB);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onupgradeneeded = () => {
            request.transaction?.abort();
            resolve(null);
        };
    });
}

export interface LegacyScan {
    projects: OldProject[];
}

export async function scanLegacy(): Promise<LegacyScan | null> {
    if (await kvGet('legacyImported', false)) {
        return null;
    }
    const database = await openOld();
    if (!database) {
        return null;
    }
    try {
        const rows = await readAll(database, 'projects');
        const projects = rows.filter((row) => row && typeof row === 'object').map((row) => (row as { project?: unknown }).project ?? row).filter(isOldProject);
        return projects.length > 0 ? { projects } : null;
    } finally {
        database.close();
    }
}

export async function importLegacy(scan: LegacyScan): Promise<{ imported: number; skipped: number }> {
    const areaIds = new Map<string, string>();
    const database = await openOld();
    const maps = database ? await readAll(database, 'maps').finally(() => database.close()) : [];
    for (const raw of maps) {
        try {
            const pkg = await sanitizeArea(await verifyArea(raw));
            if (!(await db.areaMeta.get(pkg.id))) {
                await saveArea({ ...pkg, origin: 'legacy' });
            }
            areaIds.set(pkg.id, pkg.id);
        } catch {
            // A damaged legacy map package is skipped; its plans fall back to the bundled area or none.
        }
    }
    let imported = 0;
    let skipped = 0;
    for (const old of scan.projects) {
        try {
            const mapId = typeof old.mapPackageId === 'string' ? old.mapPackageId : '';
            const area = mapId && (areaIds.has(mapId) || BUNDLED_AREAS.some((b) => b.id === mapId)) ? mapId : null;
            const parsed = ProjectSchema.safeParse(convertOldProject(old, area));
            if (!parsed.success) {
                skipped++;
                continue;
            }
            await saveProject(parsed.data as never);
            imported++;
        } catch {
            skipped++;
        }
    }
    // Mark as done even with skips: re-running would duplicate the plans already brought over.
    await kvSet('legacyImported', true);
    return { imported, skipped };
}

export async function dismissLegacy(): Promise<void> {
    await kvSet('legacyImported', true);
}
