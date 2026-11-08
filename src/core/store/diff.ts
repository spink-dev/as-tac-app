import { SYNCED_COLLECTIONS, type Project, type SyncedCollection } from '../model/schema';

export type DiffCollection = SyncedCollection | 'tracks';
export const HISTORY_COLLECTIONS: DiffCollection[] = [...SYNCED_COLLECTIONS, 'tracks'];
export const ORDER_ID = '__order';

export interface EntityOp {
    collection: DiffCollection | 'meta';
    /** Entity id, `meta`, or `__order` (data = full id sequence of the collection). */
    entityId: string;
    /** `null` deletes the entity. */
    data: unknown | null;
}

export function metaOf(project: Project) {
    return { name: project.name, areaId: project.areaId, event: project.event ?? null, settings: project.settings };
}

function sameSequence(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Entity-level diff. Immer's structural sharing keeps untouched entities reference-equal,
 * so this is O(n) pointer comparisons. Reorders and mid-list inserts additionally emit an
 * `__order` op; pure appends and deletes do not (peers append in the same order anyway).
 */
export function diffProjects(prev: Project, next: Project, collections: readonly DiffCollection[] = SYNCED_COLLECTIONS): EntityOp[] {
    const ops: EntityOp[] = [];
    for (const collection of collections) {
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
        const afterIds = after.map((item) => item.id);
        const expected = [...before.filter((item) => ids.has(item.id)).map((item) => item.id), ...afterIds.filter((id) => !previous.has(id))];
        if (!sameSequence(expected, afterIds)) {
            ops.push({ collection, entityId: ORDER_ID, data: afterIds });
        }
    }
    if (prev.name !== next.name || prev.areaId !== next.areaId || prev.event !== next.event || prev.settings !== next.settings) {
        ops.push({ collection: 'meta', entityId: 'meta', data: metaOf(next) });
    }
    return ops;
}

/** Current value of the entity an op addresses (`undefined` = absent). */
export function entityOf(project: Project, op: EntityOp): unknown {
    if (op.collection === 'meta') {
        return metaOf(project);
    }
    const list = project[op.collection] as { id: string }[];
    if (op.entityId === ORDER_ID) {
        return list.map((item) => item.id);
    }
    return list.find((item) => item.id === op.entityId);
}

/** Apply entity operations (last writer wins per entity, in the given order). */
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
        if (op.entityId === ORDER_ID) {
            const order = new Map((op.data as string[] | null ?? []).map((id, i) => [id, i]));
            const indexed = list.map((item, i) => ({ item, key: order.get(item.id) ?? order.size + i }));
            indexed.sort((a, b) => a.key - b.key);
            list.splice(0, list.length, ...indexed.map((entry) => entry.item));
            continue;
        }
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
    repairReferences(project);
}

/** Concurrent deletes can orphan references; point them somewhere valid instead of failing validation. */
export function repairReferences(project: Project): void {
    if (project.layers.length === 0) {
        project.layers.push({ id: 'layer_default', name: 'Plan', visible: true, opacity: 1, locked: false });
    }
    const layers = new Set(project.layers.map((layer) => layer.id));
    const fallback = project.layers[0].id;
    // Entities may be frozen history objects: replace, never mutate.
    project.elements.forEach((element, i) => {
        if (element.layerId && !layers.has(element.layerId)) {
            project.elements[i] = { ...element, layerId: fallback };
        }
    });
    project.drawings.forEach((stroke, i) => {
        if (stroke.layerId && !layers.has(stroke.layerId)) {
            project.drawings[i] = { ...stroke, layerId: fallback };
        }
    });
    // Team and image references may legitimately arrive before their target in a live
    // session; they are resolved at render time instead of being stripped here.
}
