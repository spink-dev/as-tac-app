import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import type { Project } from '../model/schema';
import { nowIso } from '../model/factory';

enablePatches();

export interface HistoryEntry {
    label: string;
    patches: Patch[];
    inverse: Patch[];
    at: number;
    key?: string;
}

export type ChangeSource = 'local' | 'remote' | 'undo' | 'redo' | 'load';
export type ChangeListener = (prev: Project | null, next: Project | null, source: ChangeSource) => void;

export interface MutateOptions {
    /** Consecutive edits with the same key within 800 ms merge into one undo step. */
    key?: string;
    remote?: boolean;
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
        if (!project || (readOnly && !options.remote)) {
            return false;
        }
        const [next, patches, inverse] = produceWithPatches(project, (draft) => {
            recipe(draft);
            if (!options.remote) {
                draft.updatedAt = nowIso();
            }
        });
        if (patches.length === 0 || next === project) {
            return false;
        }
        if (options.remote) {
            set({ project: next, revision: get().revision + 1 });
            emit(project, next, 'remote');
            return true;
        }
        const now = Date.now();
        const last = past[past.length - 1];
        let nextPast: HistoryEntry[];
        if (options.key && last && last.key === options.key && now - last.at < 800) {
            nextPast = [...past.slice(0, -1), { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: now }];
        } else {
            nextPast = [...past, { label, patches, inverse, at: now, key: options.key }].slice(-HISTORY_LIMIT);
        }
        set({ project: next, past: nextPast, future: [], revision: get().revision + 1 });
        emit(project, next, 'local');
        return true;
    },
    undo() {
        const { project, past, future, readOnly } = get();
        const entry = past[past.length - 1];
        if (!project || !entry || readOnly) {
            return null;
        }
        const next = applyPatches(project, entry.inverse);
        set({ project: next, past: past.slice(0, -1), future: [entry, ...future], revision: get().revision + 1 });
        emit(project, next, 'undo');
        return entry.label;
    },
    redo() {
        const { project, past, future, readOnly } = get();
        const entry = future[0];
        if (!project || !entry || readOnly) {
            return null;
        }
        const next = applyPatches(project, entry.patches);
        set({ project: next, past: [...past, entry], future: future.slice(1), revision: get().revision + 1 });
        emit(project, next, 'redo');
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
