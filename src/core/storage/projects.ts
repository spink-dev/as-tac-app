import { create } from 'zustand';
import { db, type BackupRow, type KvRow, type LiveLinkRow, type OutboxRow, type ProjectIndexRow, type ProjectRow } from './db';
import { FORMAT_VERSION, ProjectSchema, type Project } from '../model/schema';
import { migrateProject, versionOf } from '../model/migrations';
import { APP_VERSION } from '../../version';
import { onProjectChange, useProject } from '../store/project';
import { duplicateProject, uid } from '../model/factory';
import { MAX } from '../model/schema';
import { toast } from '../store/ui';
import { t } from '../../i18n';

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
        formatVersion: project.formatVersion,
    };
}

/**
 * Store a plan. A stored record written by a newer app is never replaced: the save fails with
 * 'newer' (autosave then keeps this tab's edits as a copy, see `write`). Replacing a record of an
 * older format keeps that original as a backup first (also when no migration wrote one).
 *
 * The stored format is read from the small index row, which every writer (this and later versions)
 * updates in the same transaction as the plan; index rows of 1.0.0-alpha.1 have none (= format 1).
 * So an autosave does not read the whole stored plan back each time.
 */
export async function saveProject(project: Project, current: number = FORMAT_VERSION): Promise<void> {
    const live = Boolean(await db.liveLinks.get(project.id));
    await db.transaction('rw', db.projects, db.projectIndex, db.backups, async () => {
        const index = await db.projectIndex.get(project.id);
        // Without an index row (should not happen) the record itself tells its format.
        const stored = index ? index.formatVersion ?? 1 : await db.projects.get(project.id).then((row) => (row ? versionOf(row.data) || 1 : null));
        if (stored !== null && stored > current) {
            throw new Error('newer');
        }
        if (stored !== null && stored < current) {
            const existing = await db.projects.get(project.id);
            const version = versionOf(existing?.data);
            if (existing && version > current) {
                throw new Error('newer');
            }
            const key = `${project.id}@${version}`;
            if (existing && version < current && !(await db.backups.get(key))) {
                await db.backups.put({ id: key, projectId: project.id, formatVersion: version, appVersion: APP_VERSION, createdAt: new Date().toISOString(), data: existing.data });
            }
        }
        await db.projects.put({ id: project.id, data: project });
        await db.projectIndex.put(indexRow(project, live));
    });
}

export async function listProjects(): Promise<ProjectIndexRow[]> {
    return db.projectIndex.orderBy('updatedAt').reverse().toArray();
}

/**
 * A stored plan in the current format. An older record is migrated: its original goes to
 * `backups`, the migrated plan is written back. A record from a newer app is refused ('newer')
 * and left untouched, so going back to that version loses nothing.
 */
/** How stored plans are read: current format, its migration and its validation (tests pass a future format). */
export interface StoredFormat {
    current: number;
    migrate: (input: unknown) => Project;
    parse: (input: unknown) => Project | null;
}

export const STORED_FORMAT: StoredFormat = {
    current: FORMAT_VERSION,
    migrate: migrateProject,
    parse: (input) => {
        const parsed = ProjectSchema.safeParse(input);
        if (!parsed.success) {
            console.warn('stored project failed validation', parsed.error.issues.slice(0, 5));
            return null;
        }
        return parsed.data as Project;
    },
};

export function loadProject(id: string): Promise<Project> {
    return loadStored(id, STORED_FORMAT);
}

/**
 * A stored plan in the current format. An older record is migrated: its original goes to
 * `backups` (never overwritten), the migrated plan is written back — unless the record changed in
 * the meantime or storage refuses, then the migrated plan opens unsaved and the original stays.
 * A record from a newer app is refused ('newer') and left untouched.
 */
export async function loadStored(id: string, format: StoredFormat): Promise<Project> {
    const row = await db.projects.get(id);
    if (!row) {
        throw new Error('missing');
    }
    const version = versionOf(row.data);
    if (version > format.current) {
        throw new Error('newer');
    }
    if (version === format.current) {
        const project = format.parse(row.data);
        if (!project) {
            throw new Error('invalid');
        }
        return project;
    }
    let project: Project;
    try {
        project = format.migrate(row.data);
    } catch (error) {
        console.warn('stored project could not be migrated', error);
        throw new Error('invalid');
    }
    try {
        await db.transaction('rw', db.projects, db.projectIndex, db.backups, async () => {
            const current = await db.projects.get(id);
            if (!current || versionOf(current.data) !== version) {
                // Written by someone else since it was read: leave it to them.
                return;
            }
            const key = `${id}@${version}`;
            if (!(await db.backups.get(key))) {
                await db.backups.put({ id: key, projectId: id, formatVersion: version, appVersion: APP_VERSION, createdAt: new Date().toISOString(), data: current.data });
            }
            await db.projects.put({ id, data: project });
            const index = await db.projectIndex.get(id);
            await db.projectIndex.put({ ...indexRow(project, Boolean(index?.live)), updatedAt: index?.updatedAt ?? project.updatedAt });
        });
    } catch (error) {
        // E.g. storage full after an update: open the migrated plan anyway; the original stays as it was.
        console.warn('migrated project could not be written back', error);
    }
    return project;
}

/** Plans with a backup from before a format migration. */
export async function plansWithBackup(): Promise<Set<string>> {
    const keys = await db.backups.toCollection().primaryKeys();
    return new Set(keys.map((key) => String(key).replace(/@\d+$/, '')));
}

/**
 * The plan as it was before its last format migration, migrated again by this version and stored as
 * a new plan (the current one stays). Useful when a migration got something wrong and a later version fixed it.
 */
export async function restoreBackup(projectId: string): Promise<Project> {
    const rows = await db.backups.where('projectId').equals(projectId).toArray();
    const latest = rows.sort((a, b) => b.formatVersion - a.formatVersion)[0];
    if (!latest) {
        throw new Error('missing');
    }
    const restored = migrateProject(latest.data);
    const copy = duplicateProject(restored, t('library.backupName', { name: restored.name.slice(0, MAX.projectName - 20) }));
    await saveProject(copy);
    return copy;
}

/** Drop migration backups older than 60 days. */
export async function pruneBackups(now = Date.now()): Promise<void> {
    const cutoff = new Date(now - 60 * 24 * 3600 * 1000).toISOString();
    await db.backups.where('createdAt').below(cutoff).delete();
}

/** Everything removed with a plan, so the deletion can be undone exactly (also for plans this app can't open). */
export interface DeletedPlan {
    project?: ProjectRow;
    index?: ProjectIndexRow;
    link?: LiveLinkRow;
    outbox: OutboxRow[];
    versions?: KvRow;
    backups: BackupRow[];
}

export async function deleteProject(id: string): Promise<DeletedPlan> {
    return db.transaction('rw', [db.projects, db.projectIndex, db.liveLinks, db.liveOutbox, db.kv, db.backups], async () => {
        const snapshot: DeletedPlan = {
            project: await db.projects.get(id),
            index: await db.projectIndex.get(id),
            link: await db.liveLinks.get(id),
            outbox: await db.liveOutbox.where('projectId').equals(id).toArray(),
            versions: await db.kv.get(`live:v:${id}`),
            backups: await db.backups.where('projectId').equals(id).toArray(),
        };
        await db.projects.delete(id);
        await db.backups.where('projectId').equals(id).delete();
        await db.projectIndex.delete(id);
        await db.liveLinks.delete(id);
        await db.liveOutbox.where('projectId').equals(id).delete();
        await db.kv.delete(`live:v:${id}`);
        return snapshot;
    });
}

/** Undo `deleteProject`: the stored rows come back as they were. */
export async function restoreDeleted(snapshot: DeletedPlan): Promise<void> {
    await db.transaction('rw', [db.projects, db.projectIndex, db.liveLinks, db.liveOutbox, db.kv, db.backups], async () => {
        if (snapshot.project) {
            await db.projects.put(snapshot.project);
        }
        if (snapshot.index) {
            await db.projectIndex.put(snapshot.index);
        }
        if (snapshot.link) {
            await db.liveLinks.put(snapshot.link);
        }
        if (snapshot.versions) {
            await db.kv.put(snapshot.versions);
        }
        await db.liveOutbox.bulkPut(snapshot.outbox);
        await db.backups.bulkPut(snapshot.backups);
    });
}

export async function duplicateStored(id: string, name: string): Promise<Project> {
    const copy = duplicateProject(await loadProject(id), name);
    await saveProject(copy);
    return copy;
}

let timer = 0;
let pending: Project | null = null;
/** Plans whose stored record a newer app took over while open here: this window saves to a copy (id). */
const copies = new Map<string, string>();

/** The id this window saves the plan under (a copy, when a newer app took the original over). */
export function savedAs(id: string): string {
    return copies.get(id) ?? id;
}

type CopyListener = (originalId: string, copyId: string) => void;
const copyListeners = new Set<CopyListener>();

/** A plan's saves were redirected to a copy (e.g. a live session must stop syncing the original). */
export function onSavedAsCopy(listener: CopyListener): () => void {
    copyListeners.add(listener);
    return () => {
        copyListeners.delete(listener);
    };
}

function target(project: Project): Project {
    const copy = copies.get(project.id);
    return copy ? { ...project, id: copy, name: t('save.copyName', { name: project.name.slice(0, MAX.projectName - 20) }) } : project;
}
let inflight: Promise<boolean> | null = null;

/** Serialise writes so a close waits for (and learns the result of) a write already running. */
function flush(): Promise<boolean> {
    const run = (inflight ?? Promise.resolve(true)).then(() => write());
    inflight = run.finally(() => {
        if (inflight === tracked) {
            inflight = null;
        }
    });
    const tracked = inflight;
    return run;
}

/** Returns false when the write failed; the unsaved project stays pending for a retry. */
async function write(): Promise<boolean> {
    const project = pending;
    pending = null;
    if (!project) {
        return true;
    }
    useSaveState.setState({ state: 'saving' });
    // Last line of defence: never store a record that loadProject would refuse.
    const valid = ProjectSchema.safeParse(project);
    if (!valid.success) {
        const issue = valid.error.issues[0];
        console.error('refusing to store invalid project', valid.error.issues.slice(0, 5));
        useSaveState.setState({ state: 'error', error: `invalid: ${issue?.path.join('.') ?? ''}` });
        // Keep it pending so a later close keeps reporting the failure instead of dropping edits.
        pending = pending ?? project;
        return false;
    }
    try {
        await saveProject(target(project));
        useSaveState.setState({ state: pending ? 'saving' : 'saved', error: undefined });
        return true;
    } catch (error) {
        if ((error as Error)?.message === 'newer' && !copies.has(project.id)) {
            // A newer app changed this plan meanwhile (another window, a later version): its record
            // stays as it is, and this window's edits go to a copy from now on — nothing is lost.
            copies.set(project.id, uid());
            try {
                const copy = target(project);
                await saveProject(copy);
                toast(t('save.keptAsCopy', { name: copy.name }), { tone: 'warn' });
                copyListeners.forEach((listener) => listener(project.id, copy.id));
                useSaveState.setState({ state: pending ? 'saving' : 'saved', error: undefined });
                return true;
            } catch (copyError) {
                error = copyError;
            }
        }
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
