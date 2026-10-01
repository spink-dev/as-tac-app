import type { MapPackage } from '../packages/maps';
import { execute, type Change, type Command } from './commands';
import { ProjectDatabase, type ProjectSummary, type SavedProject } from './database';
import { createProject, duplicateProject, ProjectError, type Project } from './model';

export interface ProjectState {
    project: Project | null;
    projects: ProjectSummary[];
    saveState: 'empty' | 'saved' | 'dirty' | 'saving' | 'error';
    busy: boolean;
    ready: boolean;
    error: unknown;
    readOnly: boolean;
    canUndo: boolean;
    canRedo: boolean;
}
/** One editing session per tab. Revision checks prevent silent overwrites by other tabs. */
export class ProjectSession {
    private database: ProjectDatabase | null = null;
    private state: ProjectState = { project: null, projects: [], saveState: 'empty', busy: true, ready: false, error: null, readOnly: false, canUndo: false, canRedo: false };
    private listeners = new Set<() => void>();
    private revision = 0;
    private generation = 0;
    private history: Change[] = [];
    private future: Change[] = [];
    private group: { key: string; time: number } | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private writing = false;
    private disposed = false;

    getSnapshot = () => this.state;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private publish(patch: Partial<ProjectState>) {
        this.state = { ...this.state, ...patch, canUndo: this.history.length > 0, canRedo: this.future.length > 0 };
        this.listeners.forEach((listener) => listener());
    }
    async start() {
        try {
            this.database = await ProjectDatabase.open();
            if (this.disposed) {
                this.database.close();
                return;
            }
            const projects = await this.database.list();
            this.publish({ projects, ready: true, busy: false });
            let lastId: string | null = null;
            try {
                lastId = localStorage.getItem('as-tac-active-project');
            } catch {
                // Storage preferences are optional; project data lives in IndexedDB.
            }
            const first = projects.find((project) => project.id === lastId && project.readable) ?? projects.find((project) => project.readable);
            if (first) {
                await this.open(first.id);
            }
        } catch (error) {
            this.publish({ busy: false, error });
        }
    }
    dispose() {
        this.disposed = true;
        clearTimeout(this.timer);
        this.database?.close();
    }
    canLeave = () => !this.state.busy && (this.state.saveState === 'saved' || this.state.saveState === 'empty');

    private remember(id: string | null) {
        try {
            if (id) {
                localStorage.setItem('as-tac-active-project', id);
            } else {
                localStorage.removeItem('as-tac-active-project');
            }
        } catch {
            // A blocked preference store must not prevent project saves.
        }
    }
    private accept(record: SavedProject) {
        this.remember(record.project.id);
        this.revision = record.revision;
        this.history = [];
        this.future = [];
        this.group = null;
        this.generation += 1;
        this.publish({ project: record.project, readOnly: record.readOnly === true, saveState: 'saved', error: null });
    }
    private async action(run: (database: ProjectDatabase) => Promise<void>) {
        if (!this.database || !this.canLeave()) {
            return;
        }
        this.publish({ busy: true, error: null });
        try {
            await run(this.database);
            this.publish({ projects: await this.database.list() });
        } catch (error) {
            this.publish({ error });
        } finally {
            this.publish({ busy: false });
        }
    }
    open = async (id: string) => {
        await this.action(async (database) => {
            if (id) {
                this.accept(await database.load(id));
            } else {
                this.history = [];
                this.future = [];
                this.remember(null);
                this.publish({ project: null, readOnly: false, saveState: 'empty' });
            }
        });
    };
    getRevision = () => this.revision;
    importBundle = async (project: Project, map: MapPackage, signal: AbortSignal) => {
        if (!this.database || !this.canLeave()) {
            throw new ProjectError('storage');
        }
        this.publish({ busy: true, error: null });
        try {
            this.accept(await this.database.importBundle(project, map, signal));
            this.publish({ projects: await this.database.list() });
        } finally {
            this.publish({ busy: false });
        }
    };
    create = async (name: string, mapPackageId: string) => {
        await this.action(async (database) => {
            this.accept(await database.save(createProject(name, mapPackageId), 0));
        });
    };
    duplicate = async (name: string) => {
        await this.action(async (database) => {
            if (this.state.project) {
                this.accept(await database.save(duplicateProject(this.state.project, name), 0));
            }
        });
    };
    remove = async () => {
        await this.action(async (database) => {
            if (this.state.project) {
                await database.remove(this.state.project.id, this.revision);
                this.history = [];
                this.future = [];
                this.remember(null);
                this.publish({ project: null, readOnly: false, saveState: 'empty' });
            }
        });
    };
    change = (commands: Command[], groupKey?: string) => {
        if (this.state.readOnly || !this.state.project || this.state.busy) {
            return;
        }
        try {
            const result = execute(this.state.project, commands);
            if (JSON.stringify(result.project) === JSON.stringify(this.state.project)) {
                return;
            }
            const last = this.history.at(-1);
            if (commands.length === 1 && commands[0].kind === 'project' && groupKey && last && this.group?.key === groupKey && Date.now() - this.group.time < 1_000 && this.future.length === 0) {
                // Coalesce continuous edits to a single project field without growing the history.
                last.forward = result.change.forward;
            } else {
                this.history.push(result.change);
                // Session-local bounded history, never confused with a durable online operation log.
                this.history = this.history.slice(-50);
            }
            this.group = groupKey ? { key: groupKey, time: Date.now() } : null;
            this.future = [];
            this.dirty(result.project);
        } catch (error) {
            this.publish({ error });
        }
    };
    undo = () => {
        if (this.state.readOnly || !this.state.project || this.state.busy || !this.history.length) {
            return;
        }
        const change = this.history.at(-1)!;
        const result = execute(this.state.project, change.inverse);
        this.history.pop();
        this.future.push(change);
        this.group = null;
        this.dirty(result.project);
    };
    redo = () => {
        if (this.state.readOnly || !this.state.project || this.state.busy || !this.future.length) {
            return;
        }
        const change = this.future.at(-1)!;
        const result = execute(this.state.project, change.forward);
        this.future.pop();
        this.history.push(change);
        this.group = null;
        this.dirty(result.project);
    };
    private dirty(project: Project) {
        this.generation += 1;
        this.publish({ project, saveState: 'dirty', error: null });
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), 250);
    }
    flush = async () => {
        clearTimeout(this.timer);
        if (!this.database || !this.state.project || this.writing || !['dirty', 'error'].includes(this.state.saveState)) {
            return;
        }
        this.writing = true;
        const generation = this.generation;
        const project = this.state.project;
        this.publish({ saveState: 'saving', error: null });
        let saved = false;
        try {
            const record = await this.database.save(project, this.revision);
            this.revision = record.revision;
            saved = true;
            this.publish({
                saveState: generation === this.generation ? 'saved' : 'dirty',
                projects: this.state.projects.map((item) => item.id === record.project.id ? { ...item, name: record.project.name } : item),
            });
        } catch (error) {
            this.publish({ saveState: 'error', error });
        } finally {
            this.writing = false;
        }
        if (saved && generation !== this.generation && !this.disposed) {
            await this.flush();
        }
    };
    /** Explicit recovery: preserve this tab's draft as a NEW project after quota/conflict errors. */
    recoverCopy = async () => {
        if (!this.database || !this.state.project || this.writing || this.state.busy || this.state.saveState !== 'error') {
            return;
        }
        this.publish({ busy: true });
        try {
            const project = duplicateProject(this.state.project, this.state.project.name);
            this.accept(await this.database.save(project, 0));
            this.publish({ projects: await this.database.list() });
        } catch (error) {
            this.publish({ error });
        } finally {
            this.publish({ busy: false });
        }
    };
    async recoveryData(id?: string): Promise<unknown> {
        if (id && this.database) {
            return this.database.raw(id);
        }
        if (!this.state.project) {
            throw new ProjectError('missing');
        }
        return { format: 'as-tac-local-recovery', project: this.state.project, baseRevision: this.revision };
    }
}
