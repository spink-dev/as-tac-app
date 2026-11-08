import { SYNCED_COLLECTIONS, type Project, type SyncedCollection } from '../model/schema';

export interface EntityOp {
    collection: SyncedCollection | 'meta';
    entityId: string;
    /** `null` deletes the entity. */
    data: unknown | null;
}

export function metaOf(project: Project) {
    return { name: project.name, areaId: project.areaId, event: project.event ?? null, settings: project.settings };
}

/**
 * Entity-level diff. Immer's structural sharing keeps untouched entities reference-equal,
 * so this is O(n) pointer comparisons rather than deep equality.
 */
export function diffProjects(prev: Project, next: Project): EntityOp[] {
    const ops: EntityOp[] = [];
    for (const collection of SYNCED_COLLECTIONS) {
        const before = prev[collection] as { id: string }[];
        const after = next[collection] as { id: string }[];
        if (before === after) {
            continue;
        }
        const previous = new Map(before.map((item) => [item.id, item]));
        const ids = new Set<string>();
        for (const item of after) {
            ids.add(item.id);
            if (previous.get(item.id) !== item) {
                ops.push({ collection, entityId: item.id, data: item });
            }
        }
        for (const item of before) {
            if (!ids.has(item.id)) {
                ops.push({ collection, entityId: item.id, data: null });
            }
        }
    }
    if (prev.name !== next.name || prev.areaId !== next.areaId || prev.event !== next.event || prev.settings !== next.settings) {
        ops.push({ collection: 'meta', entityId: 'meta', data: metaOf(next) });
    }
    return ops;
}

/** Apply remote entity operations (last writer wins per entity, server order). */
export function applyOps(project: Project, ops: EntityOp[]): void {
    for (const op of ops) {
        if (op.collection === 'meta') {
            const meta = op.data as ReturnType<typeof metaOf> | null;
            if (meta) {
                project.name = meta.name;
                project.areaId = meta.areaId;
                project.event = meta.event ?? undefined;
                project.settings = meta.settings;
            }
            continue;
        }
        const list = project[op.collection] as { id: string }[];
        const index = list.findIndex((item) => item.id === op.entityId);
        if (op.data === null) {
            if (index >= 0) {
                list.splice(index, 1);
            }
        } else if (index >= 0) {
            list[index] = op.data as { id: string };
        } else {
            list.push(op.data as { id: string });
        }
    }
    if (project.layers.length === 0) {
        project.layers.push({ id: 'layer_default', name: 'Plan', visible: true, opacity: 1, locked: false });
    }
}
