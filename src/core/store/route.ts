import { create } from 'zustand';
import { loadProject, flushNow, saveProject } from '../storage/projects';
import { useProject } from './project';
import { useUi } from './ui';
import type { Project } from '../model/schema';
import { kvSet } from '../storage/db';

export type Route = { name: 'library' } | { name: 'workspace'; projectId: string };

export const useRoute = create<{ route: Route }>(() => ({ route: { name: 'library' } }));

export async function openProject(id: string, readOnly: false | 'viewer' | 'copy' = false): Promise<void> {
    const project = await loadProject(id);
    showProject(project, readOnly);
}

export function showProject(project: Project, readOnly: false | 'viewer' | 'copy' = false) {
    useUi.getState().resetSession();
    useProject.getState().load(project, readOnly);
    useRoute.setState({ route: { name: 'workspace', projectId: project.id } });
    void kvSet('lastProject', project.id);
}

export async function createAndOpen(project: Project): Promise<void> {
    await saveProject(project);
    showProject(project);
}

export async function closeProject(): Promise<void> {
    await flushNow();
    useProject.getState().close();
    useUi.getState().resetSession();
    useRoute.setState({ route: { name: 'library' } });
}
