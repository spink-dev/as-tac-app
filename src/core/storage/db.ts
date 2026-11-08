import Dexie, { type Table } from 'dexie';
import type { Project } from '../model/schema';
import type { AreaPackage } from '../areas/types';

export interface ProjectRow {
    id: string;
    data: Project;
}

export interface ProjectIndexRow {
    id: string;
    name: string;
    updatedAt: string;
    areaId: string | null;
    elementCount: number;
    eventLabel?: string;
    live?: boolean;
}

export interface AssetRow {
    hash: string;
    blob: Blob;
    mime: string;
    size: number;
    name?: string;
    width?: number;
    height?: number;
    createdAt: string;
}

export interface AreaRow {
    id: string;
    meta: Omit<AreaPackage, 'data'>;
    data: GeoJSON.FeatureCollection;
}

export interface AreaMetaRow {
    id: string;
    meta: Omit<AreaPackage, 'data'>;
}

export interface LiveLinkRow {
    projectId: string;
    remoteId: string;
    role: 'owner' | 'admin' | 'viewer';
    backend: 'supabase' | 'loopback';
    lastSeq: number;
    name: string;
    /** Account the link belongs to: a plan is only synced (and writable) as that account. */
    userId: string;
}

/** One pending live change per entity (`id` = projectId|collection:entityId), replaced in place on every edit. */
export interface OutboxRow {
    id: string;
    projectId: string;
    collection: string;
    entityId: string;
    data: unknown | null;
    /** The entity as it was before the first unsent edit (lets a stale base be told from a real clash). */
    prev: unknown | null;
    /** Server version this change was based on (0 = new); sent for the conflict check. */
    base: number;
    /** Send order. */
    order: number;
    clientId: string;
    createdAt: string;
}

export interface KvRow {
    key: string;
    value: unknown;
}

export class AsTacDatabase extends Dexie {
    projects!: Table<ProjectRow, string>;
    projectIndex!: Table<ProjectIndexRow, string>;
    assets!: Table<AssetRow, string>;
    areas!: Table<AreaRow, string>;
    /** Metadata only, so listing areas never loads multi-megabyte GeoJSON. */
    areaMeta!: Table<AreaMetaRow, string>;
    liveLinks!: Table<LiveLinkRow, string>;
    liveOutbox!: Table<OutboxRow, string>;
    kv!: Table<KvRow, string>;

    constructor(name = 'as-tac-v2') {
        super(name);
        this.version(1).stores({
            projects: 'id',
            projectIndex: 'id, updatedAt',
            assets: 'hash',
            areas: 'id',
            liveLinks: 'projectId, remoteId',
            outbox: '++seq, projectId',
            kv: 'key',
        });
        this.version(2).stores({ areaMeta: 'id' }).upgrade(async (tx) => {
            await tx.table('areas').each((row: AreaRow) => tx.table('areaMeta').put({ id: row.id, meta: row.meta }));
        });
        // v3: one outbox row per entity, replaced in place (no leftovers from interleaved edits).
        this.version(3).stores({ outbox: null, liveOutbox: 'id, projectId' });
    }
}

export const db = new AsTacDatabase();

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
    const row = await db.kv.get(key);
    return row ? (row.value as T) : fallback;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
    await db.kv.put({ key, value });
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
    return { usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0, persisted };
}

export async function requestPersistence(): Promise<boolean> {
    return (await navigator.storage?.persist?.().catch(() => false)) ?? false;
}
