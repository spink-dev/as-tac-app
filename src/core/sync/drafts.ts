import type { OnlineProject, Role } from './client';
import { validateProject } from '../projects/model';
import type { Draft, DraftStore } from './session';

/** Separate database: online drafts never migrate or overwrite local projects. */
export class IndexedDraftStore implements DraftStore {
    constructor(readonly key: string) {
    }
    private open(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('as-tac-online-drafts', 2);
            request.onupgradeneeded = () => {
                for (const name of ['drafts', 'snapshots']) {
                    if (!request.result.objectStoreNames.contains(name)) {
                        request.result.createObjectStore(name);
                    }
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('Storage blocked'));
        });
    }
    async cache(snapshot: OnlineProject, role: Role) {
        const db = await this.open();
        try {
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction('snapshots', 'readwrite');
                const store = tx.objectStore('snapshots');
                const previous = store.get(this.key);
                previous.onsuccess = () => {
                    if (!previous.result || previous.result.snapshot.server_seq <= snapshot.server_seq) {
                        store.put({ key: this.key, userId: this.key.split(':')[0], snapshot, role }, this.key);
                    }
                };
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error);
            });
        } finally {
            db.close();
        }
    }
    static async cached(): Promise<CachedProject[]> {
        const db = await new IndexedDraftStore('').open();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('snapshots', 'readonly');
                const request = tx.objectStore('snapshots').getAll();
                tx.oncomplete = () => {
                    try {
                        for (const record of request.result) {
                            validateProject(record.snapshot.document);
                        }
                        resolve(request.result);
                    } catch (error) {
                        reject(error);
                    }
                };
                tx.onabort = () => reject(tx.error);
            });
        } finally {
            db.close();
        }
    }
    async load(): Promise<Draft | null> {
        const db = await this.open();
        try {
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction('drafts', 'readonly');
                const request = transaction.objectStore('drafts').get(this.key);
                transaction.oncomplete = () => {
                    try {
                        const draft = request.result as Draft | undefined;
                        if (draft) {
                            validateProject(draft.project);
                            validateProject(draft.base.document);
                            if (!Array.isArray(draft.changes) || !draft.changes.length || typeof draft.sent !== 'boolean' || typeof draft.opId !== 'string') {
                                throw new Error('Invalid draft');
                            }
                        }
                        resolve(draft ?? null);
                    } catch (error) {
                        reject(error);
                    }
                };
                transaction.onabort = () => reject(transaction.error);
            });
        } finally {
            db.close();
        }
    }
    async save(draft: Draft | null) {
        const db = await this.open();
        try {
            await new Promise<void>((resolve, reject) => {
                const transaction = db.transaction('drafts', 'readwrite');
                const store = transaction.objectStore('drafts');
                if (draft) {
                    store.put(draft, this.key);
                } else {
                    store.delete(this.key);
                }
                transaction.oncomplete = () => resolve();
                transaction.onabort = () => reject(transaction.error);
            });
        } finally {
            db.close();
        }
    }
}

export interface CachedProject { key: string; userId: string; snapshot: OnlineProject; role: Role }
