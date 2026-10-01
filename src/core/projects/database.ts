import type { MapPackage } from '../packages/maps';
import { ProjectError, validateProject, type Project } from './model';

export const DATABASE_NAME = 'as-tac-projects';
export interface SavedProject {
    project: Project;
    revision: number;
    updatedAt: string;
    localChanges: true;
}
export interface ProjectSummary {
    id: string;
    name: string;
    readable: boolean;
}
function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error);
    });
}
function completed(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new ProjectError('storage'));
    });
}
function validateRecord(value: unknown): asserts value is SavedProject {
    if (!value || typeof value !== 'object') {
        throw new ProjectError('missing');
    }
    const record = value as SavedProject;
    validateProject(record.project);
    if (!Number.isSafeInteger(record.revision) || record.revision < 1 || record.localChanges !== true || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) {
        throw new ProjectError('invalid');
    }
}
export class ProjectDatabase {
    constructor(private database: IDBDatabase) {
    }

    static async open(name = DATABASE_NAME): Promise<ProjectDatabase> {
        const opening = indexedDB.open(name, 2);
        opening.onupgradeneeded = () => {
            const db = opening.result;
            if (!db.objectStoreNames.contains('projects')) {
                db.createObjectStore('projects', { keyPath: 'project.id' });
                db.createObjectStore('backups', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('maps')) {
                db.createObjectStore('maps', { keyPath: 'id' });
            }
        };
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            let blocked = false;
            opening.onsuccess = () => {
                if (blocked) {
                    opening.result.close();
                } else {
                    resolve(opening.result);
                }
            };
            opening.onerror = () => reject(opening.error);
            opening.onblocked = () => {
                blocked = true;
                reject(new ProjectError('storage'));
            };
        });
        db.onversionchange = () => db.close();
        return new ProjectDatabase(db);
    }

    close() {
        this.database.close();
    }

    async listMaps(): Promise<{ id: string; name: string; bounds: number[]; byteSize: number }[]> {
        const packages: MapPackage[] = await request(this.database.transaction('maps').objectStore('maps').getAll());
        return packages.map(({ id, name, bounds, byteSize }) => ({ id, name, bounds, byteSize }));
    }
    async loadMap(id: string): Promise<unknown> {
        return request(this.database.transaction('maps').objectStore('maps').get(id));
    }
    async installMap(pkg: MapPackage, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        const tx = this.database.transaction('maps', 'readwrite');
        const done = completed(tx);
        const abort = () => tx.abort();
        signal.addEventListener('abort', abort, { once: true });
        try {
            tx.objectStore('maps').add(pkg);
            await done;
        } finally {
            signal.removeEventListener('abort', abort);
        }
    }
    async removeMap(id: string): Promise<void> {
        const tx = this.database.transaction(['maps', 'projects'], 'readwrite');
        const done = completed(tx);
        try {
            const projects: SavedProject[] = await request(tx.objectStore('projects').getAll());
            if (projects.some((record) => record.project?.mapPackageId === id)) {
                throw new Error('referenced');
            }
            tx.objectStore('maps').delete(id);
            await done;
        } catch (error) {
            try {
                tx.abort();
            } catch {
                // Already aborted.
            }
            await done.catch(() => {
                // Keep the original error.
            });
            throw error;
        }
    }

    async list(): Promise<ProjectSummary[]> {
        const tx = this.database.transaction('projects', 'readonly');
        const values = await request(tx.objectStore('projects').getAll());
        return values.map((value) => {
            try {
                validateRecord(value);
                return { id: value.project.id, name: value.project.name, readable: true };
            } catch {
                return { id: String(value.project?.id), name: String(value.project?.name ?? value.project?.id).slice(0, 120), readable: false };
            }
        }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }

    async raw(id: string): Promise<unknown> {
        return request(this.database.transaction('projects', 'readonly').objectStore('projects').get(id));
    }

    async load(id: string): Promise<SavedProject> {
        const record = await this.raw(id);
        validateRecord(record);
        return record;
    }

    /** Compare-and-swap and dirty metadata in the same transaction; success means COMMIT. */
    async save(project: Project, expectedRevision: number): Promise<SavedProject> {
        validateProject(project);
        const copy = structuredClone(project);
        const tx = this.database.transaction(['projects', 'maps'], 'readwrite');
        const done = completed(tx);
        try {
            if (copy.mapPackageId.startsWith('local-') && !await request(tx.objectStore('maps').get(copy.mapPackageId))) {
                throw new ProjectError('missing');
            }
            const store = tx.objectStore('projects');
            const old = await request(store.get(copy.id));
            if (old) {
                validateRecord(old);
            }
            if ((old?.revision ?? 0) !== expectedRevision) {
                throw new ProjectError('conflict');
            }
            const record: SavedProject = { project: copy, revision: expectedRevision + 1, updatedAt: new Date().toISOString(), localChanges: true };
            await request(store.put(record));
            await done;
            return record;
        } catch (error) {
            try {
                tx.abort();
            } catch {
                // It may already have aborted (quota or storage failure).
            }
            await done.catch(() => {
                // Preserve the original validation or storage error.
            });
            throw error;
        }
    }

    async remove(id: string, expectedRevision: number): Promise<void> {
        const tx = this.database.transaction('projects', 'readwrite');
        const done = completed(tx);
        try {
            const store = tx.objectStore('projects');
            const old = await request(store.get(id));
            validateRecord(old);
            if (old.revision !== expectedRevision) {
                throw new ProjectError('conflict');
            }
            await request(store.delete(id));
            await done;
        } catch (error) {
            try {
                tx.abort();
            } catch {
                // Already complete or aborted.
            }
            await done.catch(() => {
                // Preserve the original validation or storage error.
            });
            throw error;
        }
    }

    /** Future, explicit format upgrades use this path. No invented legacy format is auto-converted.
     * The synchronous transform, original backup and replacement either all commit or all abort.
     */
    async migrate(id: string, transform: (raw: unknown) => Project): Promise<void> {
        const tx = this.database.transaction(['projects', 'backups'], 'readwrite');
        const done = completed(tx);
        try {
            const store = tx.objectStore('projects');
            const original = await request(store.get(id));
            if (!original) {
                throw new ProjectError('missing');
            }
            const project = transform(structuredClone(original));
            validateProject(project);
            if (project.id !== id) {
                throw new ProjectError('invalid');
            }
            // Preserve every original byte represented by structured clone, including unknown fields.
            await request(tx.objectStore('backups').add({ id: crypto.randomUUID(), projectId: id, original, createdAt: new Date().toISOString() }));
            const revision = Number.isSafeInteger(original.revision) && original.revision > 0 ? original.revision + 1 : 1;
            await request(store.put({ project, revision, updatedAt: new Date().toISOString(), localChanges: true } satisfies SavedProject));
            await done;
        } catch (error) {
            try {
                tx.abort();
            } catch {
                // Already complete or aborted.
            }
            await done.catch(() => {
                // Preserve the original validation or storage error.
            });
            throw error;
        }
    }
}
