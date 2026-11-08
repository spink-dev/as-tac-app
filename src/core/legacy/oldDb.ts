import { convertOldProject, isOldProject, type OldProject } from './astac';
import { saveArea, verifyArea } from '../areas/store';
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
    maps: unknown[];
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
        const projects = rows.map((row) => (row as { project?: unknown }).project ?? row).filter(isOldProject);
        const maps = await readAll(database, 'maps');
        return projects.length > 0 ? { projects, maps } : null;
    } finally {
        database.close();
    }
}

export async function importLegacy(scan: LegacyScan): Promise<number> {
    const areaIds = new Map<string, string>();
    for (const raw of scan.maps) {
        try {
            const pkg = await verifyArea(raw);
            if (!(await db.areas.get(pkg.id))) {
                await saveArea({ ...pkg, origin: 'legacy' });
            }
            areaIds.set(pkg.id, pkg.id);
        } catch {
            // A damaged legacy map package is skipped; its plans fall back to the bundled area or none.
        }
    }
    let count = 0;
    for (const old of scan.projects) {
        const area = old.mapPackageId && (areaIds.has(old.mapPackageId) || BUNDLED_AREAS.some((b) => b.id === old.mapPackageId)) ? old.mapPackageId : null;
        const project = convertOldProject(old, area);
        project.name = `${project.name}`;
        await saveProject(project);
        count++;
    }
    await kvSet('legacyImported', true);
    return count;
}

export async function dismissLegacy(): Promise<void> {
    await kvSet('legacyImported', true);
}
