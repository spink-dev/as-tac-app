import { create } from 'zustand';
import { db, type ProjectIndexRow } from './db';
import { ProjectSchema, type Project } from '../model/schema';
import { onProjectChange, useProject } from '../store/project';
import { duplicateProject } from '../model/factory';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const useSaveState = create<{ state: SaveState; error?: string }>(() => ({ state: 'idle' }));

function indexRow(project: Project, live = false): ProjectIndexRow {
    return {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        areaId: project.areaId,
        elementCount: project.elements.length,
        eventLabel: project.event ? `${project.event.eventId}` : undefined,
        live,
    };
}

export async function saveProject(project: Project): Promise<void> {
    const live = Boolean(await db.liveLinks.get(project.id));
    await db.transaction('rw', db.projects, db.projectIndex, async () => {
        await db.projects.put({ id: project.id, data: project });
        await db.projectIndex.put(indexRow(project, live));
    });
}

export async function listProjects(): Promise<ProjectIndexRow[]> {
    return db.projectIndex.orderBy('updatedAt').reverse().toArray();
}

export async function loadProject(id: string): Promise<Project> {
    const row = await db.projects.get(id);
    if (!row) {
        throw new Error('missing');
    }
    const parsed = ProjectSchema.safeParse(row.data);
    if (!parsed.success) {
        console.warn('stored project failed validation', parsed.error.issues.slice(0, 5));
        throw new Error('invalid');
    }
    return parsed.data as Project;
}

export async function deleteProject(id: string): Promise<void> {
    await db.transaction('rw', [db.projects, db.projectIndex, db.liveLinks, db.outbox], async () => {
        await db.projects.delete(id);
        await db.projectIndex.delete(id);
        await db.liveLinks.delete(id);
        await db.outbox.where('projectId').equals(id).delete();
    });
}

export async function duplicateStored(id: string, name: string): Promise<Project> {
    const copy = duplicateProject(await loadProject(id), name);
    await saveProject(copy);
    return copy;
}

let timer = 0;
let pending: Project | null = null;

/** Returns false when the write failed; the unsaved project stays pending for a retry. */
async function flush(): Promise<boolean> {
    const project = pending;
    pending = null;
    if (!project) {
        return true;
    }
    useSaveState.setState({ state: 'saving' });
    try {
        await saveProject(project);
        useSaveState.setState({ state: pending ? 'saving' : 'saved', error: undefined });
        return true;
    } catch (error) {
        useSaveState.setState({ state: 'error', error: error instanceof Error ? error.message : String(error) });
        pending = pending ?? project;
        return false;
    }
}

export function flushNow(): Promise<boolean> {
    window.clearTimeout(timer);
    return flush();
}

export function resetSaveState() {
    window.clearTimeout(timer);
    pending = null;
    useSaveState.setState({ state: 'idle', error: undefined });
}

/** Debounced autosave of every change (local, remote, undo) of a writable project. */
export function startAutosave(): () => void {
    const stop = onProjectChange((_prev, next, source) => {
        if (!next || source === 'load' || useProject.getState().readOnly === 'copy') {
            return;
        }
        pending = next;
        useSaveState.setState({ state: 'saving' });
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void flush(), 450);
    });
    const beforeUnload = () => {
        if (pending) {
            void flush();
        }
    };
    window.addEventListener('pagehide', beforeUnload);
    document.addEventListener('visibilitychange', beforeUnload);
    return () => {
        stop();
        window.removeEventListener('pagehide', beforeUnload);
        document.removeEventListener('visibilitychange', beforeUnload);
    };
}
