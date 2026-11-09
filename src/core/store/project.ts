import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import type { Project } from '../model/schema';
import { nowIso } from '../model/factory';
import { applyOps, diffProjects, entityOf, HISTORY_COLLECTIONS, ORDER_ID, type EntityOp } from './diff';
import { validateChange } from '../model/validate';

/**
 * Undo history is stored as entity operations, not array-index patches. That keeps it
 * correct while live peers insert or delete entities, and undo never overwrites an
 * object somebody else changed since (those ops are skipped).
 */
export interface HistoryEntry {
    label: string;
    forward: EntityOp[];
    inverse: EntityOp[];
    at: number;
    key?: string;
}

export type ChangeSource = 'local' | 'remote' | 'undo' | 'redo' | 'load';
export type ChangeListener = (prev: Project | null, next: Project | null, source: ChangeSource) => void;

export interface MutateOptions {
    /** Consecutive edits with the same key within 800 ms merge into one undo step. */
    key?: string;
    remote?: boolean;
    /** Local record that is not a plan edit (own track): saved, but not an undo step. */
    noHistory?: boolean;
}

interface ProjectState {
    project: Project | null;
    past: HistoryEntry[];
    future: HistoryEntry[];
    readOnly: false | 'viewer' | 'copy';
    revision: number;
    load: (project: Project, readOnly?: ProjectState['readOnly']) => void;
    close: () => void;
    setReadOnly: (value: ProjectState['readOnly']) => void;
    mutate: (label: string, recipe: (draft: Draft<Project>) => void, options?: MutateOptions) => boolean;
    undo: () => string | null;
    redo: () => string | null;
}

const HISTORY_LIMIT = 100;
const listeners = new Set<ChangeListener>();
const rejectListeners = new Set<(label: string, reason: string) => void>();

/** Set once an update is being applied: the page is about to reload, local edits would be lost. */
let frozen = false;

/** Refuse every further local edit, undo and redo (remote changes still apply and are saved). */
export function freezeLocalEdits() {
    frozen = true;
}

/** Fires when a change was refused because it would break the schema (too long, too many). */
export function onMutationRejected(listener: (label: string, reason: string) => void): () => void {
    rejectListeners.add(listener);
    return () => {
        rejectListeners.delete(listener);
    };
}

export function onProjectChange(listener: ChangeListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function emit(prev: Project | null, next: Project | null, source: ChangeSource) {
    for (const listener of listeners) {
        try {
            listener(prev, next, source);
        } catch (error) {
            console.error('project listener failed', error);
        }
    }
}

function stable(value: unknown): string {
    return JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : v));
}

function equal(a: unknown, b: unknown): boolean {
    return a === b || stable(a) === stable(b);
}

/**
 * Make sure every collection whose order one direction restores is also order-checked in the
 * other direction, so undo never overrides a peer's reorder it did not cause.
 */
function pairOrderOps(forward: EntityOp[], inverse: EntityOp[], before: Project, after: Project) {
    const orderOf = (ops: EntityOp[]) => new Set(ops.filter((op) => op.entityId === ORDER_ID).map((op) => op.collection));
    const f = orderOf(forward);
    const i = orderOf(inverse);
    for (const collection of i) {
        if (!f.has(collection) && collection !== 'meta') {
            forward.push({ collection, entityId: ORDER_ID, data: (after[collection] as { id: string }[]).map((item) => item.id) });
        }
    }
    for (const collection of f) {
        if (!i.has(collection) && collection !== 'meta') {
            inverse.push({ collection, entityId: ORDER_ID, data: (before[collection] as { id: string }[]).map((item) => item.id) });
        }
    }
}

function lastOpFor(ops: EntityOp[], op: EntityOp): EntityOp | undefined {
    for (let i = ops.length - 1; i >= 0; i--) {
        if (ops[i].collection === op.collection && ops[i].entityId === op.entityId) {
            return ops[i];
        }
    }
    return undefined;
}

/** Peer adds/deletes do not block an order restore; only a changed relative order of shared ids does. */
function sameRelativeOrder(expected: string[], current: string[]): boolean {
    const currentSet = new Set(current);
    const expectedSet = new Set(expected);
    const a = expected.filter((id) => currentSet.has(id));
    const b = current.filter((id) => expectedSet.has(id));
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Keep only ops whose entity still has the value this history step left behind. */
function applicable(project: Project, ops: EntityOp[], expectedState: EntityOp[]): EntityOp[] {
    return ops.filter((op) => {
        const expected = lastOpFor(expectedState, op);
        if (!expected) {
            return true;
        }
        const current = entityOf(project, op);
        if (op.entityId === ORDER_ID) {
            return sameRelativeOrder(expected.data as string[], current as string[]);
        }
        return expected.data === null ? current === undefined : equal(current, expected.data);
    });
}

function step(project: Project, ops: EntityOp[]): Project {
    return produce(project, (draft) => {
        applyOps(draft as Project, ops);
        draft.updatedAt = nowIso();
    });
}

export const useProject = create<ProjectState>((set, get) => ({
    project: null,
    past: [],
    future: [],
    readOnly: false,
    revision: 0,
    load(project, readOnly = false) {
        const prev = get().project;
        set({ project, past: [], future: [], readOnly, revision: get().revision + 1 });
        emit(prev, project, 'load');
    },
    close() {
        const prev = get().project;
        set({ project: null, past: [], future: [], readOnly: false, revision: get().revision + 1 });
        emit(prev, null, 'load');
    },
    setReadOnly(value) {
        set({ readOnly: value });
    },
    mutate(label, recipe, options = {}) {
        const { project, readOnly, past } = get();
        if (!project || ((readOnly || frozen) && !options.remote)) {
            return false;
        }
        const changed = produce(project, recipe);
        const forward = diffProjects(project, changed, HISTORY_COLLECTIONS);
        const otherFields = changed.view !== project.view;
        if (forward.length === 0 && !otherFields) {
            return false;
        }
        const problem = validateChange(changed, forward);
        if (problem) {
            console.warn('change rejected', label, problem);
            rejectListeners.forEach((listener) => listener(label, problem));
            return false;
        }
        if (options.remote || options.noHistory) {
            // A peer change ends any coalescing window: merging across it would let undo revert the peer.
            const top = past[past.length - 1];
            const barrier = top?.key ? [...past.slice(0, -1), { ...top, key: undefined }] : past;
            set({ project: changed, past: barrier, revision: get().revision + 1 });
            emit(project, changed, options.remote ? 'remote' : 'local');
            return true;
        }
        const next = produce(changed, (draft) => {
            draft.updatedAt = nowIso();
        });
        const inverse = diffProjects(changed, project, HISTORY_COLLECTIONS);
        pairOrderOps(forward, inverse, project, changed);
        const now = Date.now();
        const last = past[past.length - 1];
        let nextPast = past;
        if (forward.length > 0) {
            if (options.key && last && last.key === options.key && now - last.at < 800) {
                nextPast = [...past.slice(0, -1), { ...last, forward: [...last.forward, ...forward], inverse: [...inverse, ...last.inverse], at: now }];
            } else {
                nextPast = [...past, { label, forward, inverse, at: now, key: options.key }].slice(-HISTORY_LIMIT);
            }
        }
        set({ project: next, past: nextPast, future: forward.length > 0 ? [] : get().future, revision: get().revision + 1 });
        emit(project, next, 'local');
        return true;
    },
    undo() {
        const { project, past, future, readOnly } = get();
        const entry = past[past.length - 1];
        if (!project || !entry || readOnly || frozen) {
            return null;
        }
        const ops = applicable(project, entry.inverse, entry.forward);
        const next = ops.length > 0 ? step(project, ops) : project;
        set({ project: next, past: past.slice(0, -1), future: [entry, ...future], revision: get().revision + 1 });
        if (next !== project) {
            emit(project, next, 'undo');
        }
        return entry.label;
    },
    redo() {
        const { project, past, future, readOnly } = get();
        const entry = future[0];
        if (!project || !entry || readOnly || frozen) {
            return null;
        }
        const ops = applicable(project, entry.forward, entry.inverse);
        const next = ops.length > 0 ? step(project, ops) : project;
        set({ project: next, past: [...past, entry], future: future.slice(1), revision: get().revision + 1 });
        if (next !== project) {
            emit(project, next, 'redo');
        }
        return entry.label;
    },
}));

export function currentProject(): Project {
    const project = useProject.getState().project;
    if (!project) {
        throw new Error('no-project');
    }
    return project;
}

export function mutate(label: string, recipe: (draft: Draft<Project>) => void, options?: MutateOptions): boolean {
    return useProject.getState().mutate(label, recipe, options);
}

// Test hook for the browser suites: entity counts only, never content.
if (typeof window !== 'undefined') {
    (window as unknown as { __asTacCounts: () => Record<string, number> }).__asTacCounts = (): Record<string, number> => {
        const project = useProject.getState().project;
        if (!project) {
            return {};
        }
        return { elements: project.elements.length, drawings: project.drawings.length, tracks: project.tracks.length, phases: project.phases.length, readOnly: useProject.getState().readOnly ? 1 : 0 };
    };
}
