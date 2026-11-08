import { create } from 'zustand';
import { loadProject, flushNow, saveProject, resetSaveState } from '../storage/projects';
import { toast } from './ui';
import { t } from '../../i18n';
import { useProject } from './project';
import { useUi } from './ui';
import type { Project } from '../model/schema';
import { kvSet } from '../storage/db';

export type Route = { name: 'library' } | { name: 'workspace'; projectId: string };

export const useRoute = create<{ route: Route }>(() => ({ route: { name: 'library' } }));

type SessionPatch = Partial<Pick<ReturnType<typeof useUi.getState>, 'mode' | 'tool' | 'panel' | 'sheet' | 'streamer' | 'phaseIndex' | 'selection'>>;

/** `session`: UI state to start with (e.g. the mode and Streamer Safe profile kept across an update). */
export async function openProject(id: string, readOnly: false | 'viewer' | 'copy' = false, session?: SessionPatch): Promise<void> {
    const project = await loadProject(id);
    showProject(project, readOnly, session);
}

export function showProject(project: Project, readOnly: false | 'viewer' | 'copy' = false, session?: SessionPatch) {
    resetSaveState();
    useUi.getState().resetSession();
    if (session) {
        // Before the plan renders: a privacy view must never show the plan for even one frame.
        useUi.getState().set(session);
    }
    useProject.getState().load(project, readOnly);
    useRoute.setState({ route: { name: 'workspace', projectId: project.id } });
    void kvSet('lastProject', project.id);
}

export async function createAndOpen(project: Project): Promise<void> {
    await saveProject(project);
    showProject(project);
}

const beforeClose = new Set<() => void>();

/** Run something (e.g. save a running path recording) before the open plan closes. */
export function onBeforeClose(fn: () => void): () => void {
    beforeClose.add(fn);
    return () => {
        beforeClose.delete(fn);
    };
}

function runBeforeClose() {
    for (const fn of beforeClose) {
        try {
            fn();
        } catch (error) {
            console.warn('before-close handler failed', error);
        }
    }
}

export async function closeProject(force = false): Promise<boolean> {
    runBeforeClose();
    const saved = await flushNow();
    if (!saved && !force) {
        // Keep the workspace open: closing would drop edits that only live in memory.
        toast(t('error.storage'), { tone: 'danger', action: { label: t('common.retry'), run: () => void closeProject() } });
        return false;
    }
    useProject.getState().close();
    useUi.getState().resetSession();
    useRoute.setState({ route: { name: 'library' } });
    return true;
}
