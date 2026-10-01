import { execute, type Command } from '../projects/commands';
import type { Project, PlanElement } from '../projects/model';
import type { OnlineApi, OnlineChange, OnlineOperation, OnlineProject, Role } from './client';

export type SyncApi = Pick<OnlineApi, 'snapshot' | 'members' | 'apply' | 'operation'>;
export interface Draft {
    opId: string;
    base: OnlineProject;
    changes: OnlineChange[];
    project: Project;
    inverse: Command[];
    sent: boolean;
    mode?: 'edit' | 'undo' | 'redo';
}
export interface DraftStore {
    load(): Promise<Draft | null>;
    save(draft: Draft | null): Promise<void>;
    cache?(snapshot: OnlineProject, role: Role): Promise<void>;
}
export interface SyncState {
    snapshot: OnlineProject | null;
    project: Project | null;
    role: Role | null;
    status: 'connecting' | 'live' | 'saving' | 'offline' | 'draft' | 'conflict' | 'denied' | 'storage-error';
    draft: Draft | null;
    busy: boolean;
    canUndo: boolean;
    canRedo: boolean;
    error: string;
    held: boolean;
}
export function scope(change: OnlineChange) {
    return change.kind === 'project' ? 'project' : `${change.kind}:${change.id}`;
}
export function commands(changes: OnlineChange[]): Command[] {
    return changes.map((c) => c.kind === 'project' ? { kind: 'project', ...(c.value as object) } as Command : { kind: c.kind, id: c.id, value: c.value } as Command);
}
export function prepare(base: OnlineProject, batch: Command[]): Draft {
    // Collapse repeated writes to one scope, preserving the final atomic action.
    const final = execute(base.document, batch).project;
    const changes = new Map<string, OnlineChange>();
    for (const c of batch) {
        const id = c.kind === 'project' ? base.id : c.id;
        const key = c.kind === 'project' ? 'project' : `${c.kind}:${id}`;
        const expectedVersion = base.versions[key] ?? 0;
        let value: unknown;
        if (c.kind === 'project') {
            value = { name: final.name, mapPackageId: final.mapPackageId };
        } else {
            const collection = c.kind === 'element' ? final.elements : c.kind === 'team' ? final.teams : final.phases;
            value = collection.find((item) => item.id === id) ?? null;
            if (value && c.kind === 'element') {
                value = { ...value as PlanElement, version: expectedVersion + 1 };
            }
        }
        changes.set(key, { kind: c.kind, id, value, expectedVersion });
    }
    const list = JSON.parse(JSON.stringify([...changes.values()])) as OnlineChange[];
    const result = execute(base.document, commands(list));
    return { opId: crypto.randomUUID(), base: structuredClone(base), changes: list, project: result.project, inverse: result.change.inverse, sent: false };
}

/** One unresolved atomic action at a time. Uncertain sends retain their exact identity. */
export class OnlineSession {
    private state: SyncState = { snapshot: null, project: null, role: null, status: 'connecting', draft: null, busy: true, canUndo: false, canRedo: false, error: '', held: false };
    private editBase: OnlineProject | null = null;
    private listeners = new Set<() => void>();
    private stopped = false;
    private refreshing = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private history: { undo: Command[]; redo: Command[]; versions: Record<string, number>; baseVersions: Record<string, number>; scopes: string[] }[] = [];
    private redoHistory: typeof this.history = [];
    constructor(readonly api: SyncApi, readonly projectId: string, readonly userId: string, readonly store: DraftStore, readonly offline?: { snapshot: OnlineProject; role: Role }) {
    }
    getSnapshot = () => this.state;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private update(patch: Partial<SyncState>) {
        if (this.stopped) {
            return;
        }
        this.state = { ...this.state, ...patch };
        const allowed = !this.state.held && !this.state.busy && !this.state.draft && this.state.status === 'live' && this.state.role !== 'viewer';
        const matches = (entry: typeof this.history[number] | undefined) => !!entry && entry.scopes.every((s) => entry.versions[s] === this.state.snapshot?.versions[s]);
        this.state.canUndo = allowed && matches(this.history.at(-1));
        this.state.canRedo = allowed && matches(this.redoHistory.at(-1));
        for (const listener of this.listeners) {
            listener();
        }
    }
    async start() {
        try {
            const draft = await this.store.load();
            if (draft && (draft.base.id !== this.projectId || draft.project.id !== this.projectId)) {
                throw new Error('Invalid draft');
            }
            this.update({ draft, project: draft?.project ?? null, busy: false });
            if (this.offline) {
                this.update({ snapshot: this.offline.snapshot, role: this.offline.role, project: draft?.project ?? this.offline.snapshot.document, status: draft ? 'draft' : 'offline' });
            } else {
                await this.refresh();
            }
        } catch {
            this.update({ status: 'storage-error', busy: false, error: 'Entwurf konnte nicht gelesen werden. Lokalen Speicher prüfen.' });
        }
    }
    poll() {
        const next = async () => {
            await this.refresh();
            if (!this.stopped) {
                this.timer = setTimeout(next, 1500);
            }
        };
        this.timer = setTimeout(next, 1500);
    }
    dispose() {
        this.stopped = true;
        clearTimeout(this.timer);
        this.listeners.clear();
    }
    private async current() {
        const role = (await this.api.members(this.projectId)).find((m) => m.user_id === this.userId)?.role ?? null;
        if (!role) {
            throw Object.assign(new Error('forbidden'), { code: '42501' });
        }
        const snapshot = await this.api.snapshot(this.projectId);
        return { role, snapshot };
    }
    async refresh() {
        if (this.offline || this.stopped || this.refreshing || this.state.busy || this.state.status === 'storage-error') {
            return;
        }
        this.refreshing = true;
        try {
            const { role, snapshot } = await this.current();
            if (this.stopped || this.state.busy || snapshot.server_seq < (this.state.snapshot?.server_seq ?? 0)) {
                return;
            }
            // A full atomic snapshot deliberately bridges all log gaps and compaction.
            const draft = this.state.draft;
            if (draft?.sent) {
                const ack = await this.api.operation(this.projectId, draft.opId);
                if (this.state.busy || this.state.draft !== draft) {
                    return;
                }
                if (ack) {
                    this.update({ busy: true });
                    await this.accept(draft, ack);
                    return;
                }
            }
            await this.cache(snapshot, role);
            if (this.state.busy || this.state.draft !== draft) {
                return;
            }
            this.update({ role, snapshot, project: draft?.project ?? this.editBase?.document ?? snapshot.document, status: draft ? (this.conflicts(draft, snapshot).length ? 'conflict' : 'draft') : 'live', error: this.cacheError });
        } catch (error) {
            this.failed(error);
        } finally {
            this.refreshing = false;
        }
    }
    private cacheError = '';
    private cachedSeq = -1;
    private cachedRole: Role | null = null;
    private async cache(snapshot: OnlineProject, role: Role) {
        if (!this.store.cache || this.cachedSeq === snapshot.server_seq && this.cachedRole === role) {
            return;
        }
        try {
            await this.store.cache(snapshot, role);
            this.cachedSeq = snapshot.server_seq;
            this.cachedRole = role;
            this.cacheError = '';
        } catch {
            this.cacheError = 'Serverstand geladen, aber Offline-Kopie konnte nicht aktualisiert werden. Speicher prüfen oder Paket exportieren.';
        }
    }
    private failed(error: unknown) {
        if ((error as { code?: string }).code === '42501' || (error as { status?: number }).status === 401) {
            this.editBase = null;
            this.update({ held: false, role: null, snapshot: null, project: null, status: 'denied', busy: false, error: 'Zugriff fehlt. Erneut anmelden oder Mitgliedschaft prüfen. Eigener Entwurf bleibt gesichert.' });
        } else {
            this.update({ status: this.state.draft ? 'draft' : 'offline', busy: false, error: 'Server nicht erreichbar. Letzter bestätigter Stand; Änderungen werden nicht automatisch nachgesendet.' });
        }
    }
    conflicts(draft = this.state.draft, snapshot = this.state.snapshot): string[] {
        if (!draft || !snapshot) {
            return [];
        }
        const changed = draft.changes.filter((c) => (snapshot.versions[scope(c)] ?? 0) !== c.expectedVersion).map(scope);
        if (draft.changes.some((c) => c.kind !== 'element') && snapshot.versions.project !== draft.base.versions.project) {
            changed.push('project');
        }
        return [...new Set(changed)];
    }
    hold = () => {
        if (!this.editBase && !this.state.busy && !this.state.draft && this.state.snapshot && this.state.role && this.state.role !== 'viewer') {
            this.editBase = this.state.snapshot;
            this.update({ held: true });
        }
    };
    resume = () => {
        this.editBase = null;
        this.update({ held: false, project: this.state.draft?.project ?? this.state.snapshot?.document ?? null });
    };
    change = (batch: Command[]) => this.begin(batch, 'edit');
    private begin(batch: Command[], mode: 'edit' | 'undo' | 'redo') {
        if (this.state.busy || this.state.draft?.sent || !this.state.snapshot || !this.state.role || this.state.role === 'viewer' || !['live', 'offline', 'draft'].includes(this.state.status)) {
            throw new Error('Änderung derzeit gesperrt');
        }
        const send = !this.offline && !this.state.draft && this.state.status === 'live' && navigator.onLine;
        const draft = prepare(this.state.draft?.base ?? this.editBase ?? this.state.snapshot, [...(this.state.draft ? commands(this.state.draft.changes) : []), ...batch]);
        this.editBase = null;
        draft.mode = mode;
        this.update({ held: false, draft, project: draft.project, busy: true, status: 'saving', error: '' });
        if (mode === 'edit') {
            this.redoHistory = [];
        }
        void this.persistAndSend(draft, send);
    }
    private async persistAndSend(draft: Draft, send: boolean) {
        try {
            await this.store.save(draft);
            if (this.stopped) {
                return;
            }
            if (send) {
                await this.send(draft);
            } else {
                this.update({ busy: false, status: 'draft' });
            }
        } catch {
            this.update({ busy: false, status: 'storage-error', error: 'Entwurf noch nicht lokal gesichert. Exportieren oder Speicher freigeben; nichts wurde gesendet.' });
        }
    }
    private async send(draft: Draft) {
        const sent = { ...draft, sent: true };
        // Persist before network: a lost response must never create a second operation.
        await this.store.save(sent);
        if (this.stopped) {
            return;
        }
        this.update({ draft: sent, busy: true, status: 'saving' });
        try {
            const ack = await this.api.apply(this.projectId, sent.opId, sent.base.versions.project, sent.changes);
            await this.accept(sent, ack);
        } catch (error) {
            if (['40001', '22023'].includes((error as { code?: string }).code ?? '')) {
                this.update({ busy: false, status: 'conflict', error: 'Zwischenzeitlich geändert. Serverstand und eigenen Entwurf vergleichen.' });
            } else {
                this.failed(error);
            }
        }
    }
    private async accept(draft: Draft, ack: OnlineOperation) {
        if (ack.op_id !== draft.opId || ack.project_id !== this.projectId || ack.actor_id !== this.userId || !same(ack.payload, { projectVersion: draft.base.versions.project, changes: draft.changes })) {
            throw new Error('Invalid acknowledgement');
        }
        const { role, snapshot } = await this.current();
        if (snapshot.server_seq < ack.server_seq) {
            throw new Error('Snapshot behind acknowledgement');
        }
        if (this.stopped) {
            return;
        }
        await this.store.save(null);
        await this.cache(snapshot, role);
        const entry = { undo: draft.inverse, redo: commands(draft.changes), versions: ack.versions, baseVersions: draft.base.versions, scopes: [...new Set([...draft.changes.map(scope), ...(draft.changes.some((c) => c.kind !== 'element') ? ['project'] : [])])] };
        const advance = (stack: typeof this.history, removed: typeof this.history[number] | undefined) => {
            const previous = stack.at(-1);
            if (!previous || !removed) {
                return;
            }
            previous.versions = { ...previous.versions };
            for (const key of entry.scopes) {
                if (previous.scopes.includes(key) && previous.versions[key] === removed.baseVersions[key]) {
                    previous.versions[key] = ack.versions[key];
                }
            }
        };
        if (draft.mode === 'undo') {
            advance(this.history, this.history.pop());
            this.redoHistory.push({ ...entry, redo: draft.inverse });
        } else {
            if (draft.mode === 'redo') {
                advance(this.redoHistory, this.redoHistory.pop());
            }
            this.history.push(entry);
        }
        this.history = this.history.slice(-50);
        this.update({ draft: null, project: snapshot.document, snapshot, role, busy: false, status: 'live', error: this.cacheError });
    }
    // Explicit retry keeps the original opId and expected versions, even after reconnect.
    retry = async () => {
        const draft = this.state.draft;
        if (this.offline || !draft || this.state.busy || !this.state.role || this.state.role === 'viewer') {
            return;
        }
        this.update({ busy: true, error: '' });
        await this.persistAndSend(draft, true);
    };
    // Choices come from a displayed snapshot. Refresh/CAS prevents unseen concurrent overwrites.
    resolve = async (mine: string[], reviewedSeq: number) => {
        const draft = this.state.draft;
        const snapshot = this.state.snapshot;
        if (this.offline || !draft || !snapshot || this.state.busy || this.state.role === 'viewer' || !this.state.role || snapshot.server_seq !== reviewedSeq) {
            return;
        }
        this.update({ busy: true });
        try {
            // An uncertain operation might already have committed; reconcile it first.
            if (draft.sent) {
                const ack = await this.api.operation(this.projectId, draft.opId);
                if (ack) {
                    await this.accept(draft, ack);
                    return;
                }
                // Never replace an uncertain opId with another one. Retry it to get a definitive outcome.
                try {
                    const ack = await this.api.apply(this.projectId, draft.opId, draft.base.versions.project, draft.changes);
                    await this.accept(draft, ack);
                    return;
                } catch (error) {
                    if (!['40001', '22023'].includes((error as { code?: string }).code ?? '')) {
                        throw error;
                    }
                }
            }
            const chosen = commands(draft.changes.filter((c) => mine.includes(scope(c))));
            if (!chosen.length) {
                await this.store.save(null);
                this.update({ draft: null, project: snapshot.document, busy: false, status: 'live', error: '' });
                return;
            }
            const next = prepare(snapshot, chosen);
            this.update({ draft: next, project: next.project });
            await this.persistAndSend(next, true);
        } catch (error) {
            this.update({ busy: false, error: 'Abgleich nicht möglich. Referenzen prüfen oder unveränderte Sendung erneut prüfen.' });
            if ((error as { code?: string }).code === '42501') {
                this.failed(error);
            }
        }
    };
    undo = () => {
        const entry = this.history.at(-1);
        if (entry && this.state.canUndo) {
            this.begin(entry.undo, 'undo');
        }
    };
    redo = () => {
        const entry = this.redoHistory.at(-1);
        if (entry && this.state.canRedo) {
            this.begin(entry.redo, 'redo');
        }
    };
}
function same(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
        return false;
    }
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((key) => Object.hasOwn(y, key) && same(x[key], y[key]));
}
