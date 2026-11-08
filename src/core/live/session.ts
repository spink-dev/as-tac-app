import { db, type LiveLinkRow, type OutboxRow } from '../storage/db';
import { getAsset, putVerifiedAsset, safeMime, sha256Hex } from '../storage/assets';
import { flushNow, saveProject } from '../storage/projects';
import { mutate, onProjectChange, useProject } from '../store/project';
import { applyOps, diffProjects, metaOf, ORDER_ID, type DiffCollection, type EntityOp } from '../store/diff';
import { SYNCED_COLLECTIONS, ProjectSchema, type Project } from '../model/schema';
import { createProject, uid } from '../model/factory';
import { validEntity } from '../model/validate';
import { usePrefs } from '../store/prefs';
import { toast, useUi } from '../store/ui';
import { t } from '../../i18n';
import { resetLive, useLive, type LiveRole, type Presence } from './state';
import { setBriefingSender } from './briefingSync';
import { currentCamera, mapRef, renderPlan } from '../../map/MapView';
import { LoopbackBackend } from './loopback';
import { SupabaseBackend, supabaseConfigured } from './supabase';
import type { BriefingMessage, JoinInfo, LiveBackend, LiveTransport, PushOp, RemoteCollection, RemoteEntity } from './types';

/**
 * Live sync engine. Local edits become entity operations in a persistent outbox, each carrying
 * the server version it was based on. The server applies an op only if that version is still
 * current; otherwise the newer server value comes back and the clash is shown to the user
 * (never silently overwritten). Remote changes are applied as `remote` mutations, so undo
 * history stays local and never reverts a partner's work. Own GPS is never part of any op.
 */

export interface LiveConflict {
    id: string;
    collection: RemoteCollection;
    entityId: string;
    label: string;
    mine: unknown | null;
}

const PRESENCE_COLORS = ['#e8402a', '#2f9fe0', '#3bb273', '#f2c230', '#b5487f', '#1f9aa6', '#d08a1e', '#7a4cc2'];
const BATCH = 400;

export function backendFor(kind: 'supabase' | 'loopback'): LiveBackend {
    return kind === 'supabase' ? new SupabaseBackend() : new LoopbackBackend();
}

export function preferredBackend(): 'supabase' | 'loopback' {
    return supabaseConfigured() ? 'supabase' : 'loopback';
}

const keyOf = (collection: string, entityId: string) => `${collection}:${entityId}`;

function toRemote(op: EntityOp): Omit<PushOp, 'base'> {
    if (op.collection === 'meta') {
        return { collection: 'meta', entityId: 'meta', data: op.data };
    }
    if (op.entityId === ORDER_ID) {
        return { collection: 'order', entityId: op.collection, data: op.data };
    }
    return { collection: op.collection as RemoteCollection, entityId: op.entityId, data: op.data };
}

function toLocal(entity: { collection: RemoteCollection; entityId: string; data: unknown | null }): EntityOp | null {
    if (entity.collection === 'meta') {
        return entity.data ? { collection: 'meta', entityId: 'meta', data: entity.data } : null;
    }
    if (entity.collection === 'order') {
        const collection = entity.entityId as DiffCollection;
        return (SYNCED_COLLECTIONS as readonly string[]).includes(collection) && Array.isArray(entity.data) ? { collection, entityId: ORDER_ID, data: entity.data } : null;
    }
    if (entity.data !== null && !validEntity(entity.collection, entity.data)) {
        console.warn('live: ignoring invalid entity', entity.collection, entity.entityId);
        return null;
    }
    return { collection: entity.collection, entityId: entity.entityId, data: entity.data };
}

function colorFor(id: string): string {
    let hash = 0;
    for (const char of id) {
        hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

function displayName(): string {
    return usePrefs.getState().displayName.trim().slice(0, 40) || t('live.anonymous');
}

function labelFor(collection: RemoteCollection, data: unknown): string {
    const value = data as { label?: string; name?: string; text?: string } | null;
    return value?.label || value?.name || value?.text || t(`live.kind.${collection}`);
}

/** Initial publish: every entity of the plan, containers first, then the explicit orders. */
function snapshotOps(project: Project): Omit<PushOp, 'base'>[] {
    const ops: Omit<PushOp, 'base'>[] = [{ collection: 'meta', entityId: 'meta', data: metaOf(project) }];
    for (const collection of SYNCED_COLLECTIONS) {
        for (const item of project[collection] as { id: string }[]) {
            ops.push({ collection, entityId: item.id, data: item });
        }
    }
    for (const collection of SYNCED_COLLECTIONS) {
        const items = project[collection] as { id: string }[];
        if (items.length > 1) {
            ops.push({ collection: 'order', entityId: collection, data: items.map((item) => item.id) });
        }
    }
    return ops;
}

/** Build a local plan from the server state of a live plan (join). Invalid entities are skipped. */
export function projectFromEntities(entities: RemoteEntity[], info: { name: string; areaId: string | null }): Project {
    const project = createProject({ name: info.name, areaId: info.areaId });
    project.layers = [];
    const live = entities.filter((e) => e.data !== null).sort((a, b) => a.seq - b.seq);
    const rank = (c: RemoteCollection) => (c === 'meta' ? -1 : c === 'order' ? 99 : (SYNCED_COLLECTIONS as readonly string[]).indexOf(c));
    live.sort((a, b) => rank(a.collection) - rank(b.collection) || a.seq - b.seq);
    const ops = live.map(toLocal).filter((op): op is EntityOp => op !== null);
    applyOps(project, ops);
    const parsed = ProjectSchema.safeParse(project);
    if (!parsed.success) {
        console.warn('live: joined plan failed validation', parsed.error.issues.slice(0, 5));
        throw new Error('project-invalid');
    }
    return parsed.data as Project;
}

class Session {
    readonly clientId = uid('c');
    readonly versions = new Map<string, number>();
    readonly pending = new Map<string, OutboxRow>();
    lastSeq: number;
    private flushing = false;
    private retry = 0;
    private seqTimer = 0;
    private uploaded = new Set<string>();
    private stop: (() => void)[] = [];
    leading = false;

    constructor(readonly link: LiveLinkRow, readonly transport: LiveTransport) {
        this.lastSeq = link.lastSeq;
    }

    get role(): LiveRole {
        return this.link.role;
    }

    async start() {
        useLive.setState({ status: 'connecting', backend: this.link.backend, remoteId: this.link.remoteId, role: this.role, error: null });
        if (this.role === 'viewer') {
            useProject.getState().setReadOnly('viewer');
        }
        for (const row of await db.outbox.where('projectId').equals(this.link.projectId).sortBy('seq')) {
            this.pending.set(keyOf(row.collection, row.entityId), row);
        }
        useLive.setState({ queued: this.pending.size });
        this.stop.push(onProjectChange((prev, next, source) => this.onLocal(prev, next, source)));
        await this.transport.subscribe({
            entity: (entity) => this.onRemote(entity),
            presence: (people) => {
                const leader = people.find((p) => p.leading && (p.role === 'owner' || p.role === 'admin'));
                const before = useLive.getState().leaderId;
                useLive.setState({ presence: people, leaderId: leader?.clientId ?? null, following: leader ? useLive.getState().following : false });
                if (leader && leader.clientId !== before && leader.clientId !== this.clientId) {
                    toast(t('briefing.leaderStarted', { name: leader.name }), {
                        action: {
                            label: t('briefing.follow'),
                            run: () => {
                                useLive.setState({ following: true });
                                void import('../../features/workspace/modes').then(({ setMode }) => setMode('briefing'));
                            },
                        },
                    });
                }
            },
            briefing: (message) => this.onBriefing(message),
            chat: (message) => {
                const { chat, unread } = useLive.getState();
                if (!chat.some((m) => m.id === message.id)) {
                    const open = useUi.getState().panel === 'live' && useUi.getState().sheet !== 'closed';
                    useLive.setState({ chat: [...chat.slice(-199), message], unread: open ? 0 : unread + 1 });
                }
            },
            status: (online) => {
                useLive.setState({ status: online ? 'online' : 'offline' });
                if (online) {
                    void this.catchUp();
                }
            },
        });
        this.track();
        setBriefingSender((state) => {
            if (this.leading) {
                this.transport.broadcast({ type: 'briefing', from: this.clientId, phaseIndex: state.phaseIndex, camera: state.camera });
            }
        }, () => ({ phaseIndex: useUi.getState().phaseIndex, camera: mapRef.current ? currentCamera(mapRef.current) : null }));
        if (this.role !== 'viewer') {
            void this.transport.chatHistory().then((chat) => useLive.setState({ chat })).catch(() => undefined);
        }
        const onOnline = () => void this.catchUp();
        window.addEventListener('online', onOnline);
        this.stop.push(() => window.removeEventListener('online', onOnline));
    }

    track() {
        const me: Presence = { clientId: this.clientId, name: displayName(), role: this.role, color: colorFor(this.clientId), leading: this.leading };
        this.transport.track(me);
    }

    /** Pull everything since the last seen sequence, then send what waited offline. */
    async catchUp() {
        try {
            const entities = await this.transport.pull(this.lastSeq);
            for (const entity of entities) {
                this.onRemote(entity);
            }
            useLive.setState({ status: 'online' });
            await this.flush();
        } catch (error) {
            console.warn('live: catch-up failed', error);
            useLive.setState({ status: 'offline' });
        }
    }

    private onLocal(prev: Project | null, next: Project | null, source: string) {
        if (!prev || !next || source === 'remote' || source === 'load' || next.id !== this.link.projectId || this.role === 'viewer') {
            return;
        }
        const ops = diffProjects(prev, next, SYNCED_COLLECTIONS);
        if (ops.length > 0) {
            void this.enqueue(ops.map(toRemote));
        }
    }

    async enqueue(ops: Omit<PushOp, 'base'>[]) {
        const now = new Date().toISOString();
        for (const op of ops) {
            const key = keyOf(op.collection, op.entityId);
            const existing = this.pending.get(key);
            // Repeated edits of one entity before sending collapse into one op with the original base.
            const row: OutboxRow = existing
                ? { ...existing, data: op.data, createdAt: now }
                : { projectId: this.link.projectId, collection: op.collection, entityId: op.entityId, data: op.data, base: this.versions.get(key) ?? 0, clientId: this.clientId, createdAt: now };
            row.seq = await db.outbox.put(row);
            this.pending.set(key, row);
        }
        useLive.setState({ queued: this.pending.size });
        void this.flush();
    }

    async flush(): Promise<void> {
        if (this.flushing || useLive.getState().status !== 'online') {
            return;
        }
        this.flushing = true;
        try {
            while (this.pending.size > 0) {
                const rows = [...this.pending.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).slice(0, BATCH);
                await this.uploadAssets(rows);
                const result = await this.transport.push(rows.map((row) => ({ collection: row.collection as RemoteCollection, entityId: row.entityId, data: row.data, base: row.base })), this.clientId);
                const sent = new Map(rows.map((row) => [keyOf(row.collection, row.entityId), row]));
                const done: number[] = [];
                for (const applied of result.applied) {
                    const key = keyOf(applied.collection, applied.entityId);
                    this.versions.set(key, Math.max(this.versions.get(key) ?? 0, applied.version));
                    const row = sent.get(key);
                    const current = this.pending.get(key);
                    if (row && current === row) {
                        this.pending.delete(key);
                        done.push(row.seq!);
                    } else if (current) {
                        // Edited again while in flight: that edit builds on what was just accepted.
                        current.base = applied.version;
                        await db.outbox.put(current);
                    }
                }
                for (const conflict of result.conflicts) {
                    const key = keyOf(conflict.collection, conflict.entityId);
                    const row = sent.get(key);
                    const mine = this.pending.get(key)?.data ?? row?.data ?? null;
                    this.versions.set(key, conflict.version);
                    const current = this.pending.get(key);
                    if (current?.seq !== undefined) {
                        done.push(current.seq);
                    }
                    this.pending.delete(key);
                    this.applyRemote([{ collection: conflict.collection, entityId: conflict.entityId, data: conflict.data }]);
                    this.surface({ collection: conflict.collection, entityId: conflict.entityId, mine });
                }
                await db.outbox.bulkDelete(done);
                useLive.setState({ queued: this.pending.size });
                this.retry = 0;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('live: push failed', message);
            if (message === 'forbidden') {
                // Role was lowered on the server: stop writing, keep the local plan.
                this.link.role = 'viewer';
                await db.liveLinks.put(this.link);
                useProject.getState().setReadOnly('viewer');
                useLive.setState({ role: 'viewer' });
                toast(t('live.nowViewer'), { tone: 'warn' });
            } else {
                useLive.setState({ status: 'offline' });
                this.retry = Math.min(this.retry + 1, 6);
                window.setTimeout(() => void this.catchUp(), 1000 * 2 ** this.retry);
            }
        } finally {
            this.flushing = false;
        }
    }

    private surface(conflict: { collection: RemoteCollection; entityId: string; mine: unknown | null }) {
        if (conflict.collection === 'order') {
            // Order clashes resolve to the server's order; nothing worth asking about.
            return;
        }
        const item: LiveConflict = { id: uid('cf'), ...conflict, label: labelFor(conflict.collection, conflict.mine) };
        useLive.setState({ conflicts: [...useLive.getState().conflicts.slice(-19), item] });
        toast(t('live.conflict', { name: item.label }), { tone: 'warn', action: { label: t('live.conflictOpen'), run: () => useUi.getState().set({ panel: 'live', sheet: 'half' }) } });
    }

    private async uploadAssets(rows: OutboxRow[]) {
        if (this.transport.kind !== 'supabase') {
            return;
        }
        for (const row of rows) {
            const data = row.data as { asset?: string; logoAsset?: string } | null;
            const hash = row.collection === 'images' ? data?.asset : row.collection === 'teams' ? data?.logoAsset : undefined;
            if (hash && !this.uploaded.has(hash)) {
                const asset = await getAsset(hash);
                if (asset) {
                    await this.transport.uploadAsset(hash, asset.blob);
                    this.uploaded.add(hash);
                }
            }
        }
    }

    private async ensureAsset(hash: string | undefined, mime: string | undefined) {
        if (!hash || await getAsset(hash)) {
            return;
        }
        const blob = await this.transport.downloadAsset(hash).catch(() => null);
        if (!blob || blob.size > 40 * 1024 * 1024) {
            return;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // Content-addressed: anything that doesn't hash to its name is dropped.
        if ((await sha256Hex(bytes)) === hash) {
            await putVerifiedAsset(hash, bytes, safeMime(mime ?? blob.type));
            renderPlan();
        }
    }

    private onRemote(entity: RemoteEntity) {
        if (entity.seq > this.lastSeq) {
            this.lastSeq = entity.seq;
            window.clearTimeout(this.seqTimer);
            this.seqTimer = window.setTimeout(() => void db.liveLinks.update(this.link.projectId, { lastSeq: this.lastSeq }), 1000);
        }
        const key = keyOf(entity.collection, entity.entityId);
        if (entity.version <= (this.versions.get(key) ?? 0)) {
            return;
        }
        this.versions.set(key, entity.version);
        // Own echo, or a local edit still waiting: the server decides that one (conflict check).
        if (entity.clientId === this.clientId || this.pending.has(key)) {
            return;
        }
        this.applyRemote([entity]);
        const data = entity.data as { asset?: string; logoAsset?: string; mime?: string } | null;
        if (entity.collection === 'images') {
            void this.ensureAsset(data?.asset, data?.mime);
        } else if (entity.collection === 'teams') {
            void this.ensureAsset(data?.logoAsset, undefined);
        }
    }

    applyRemote(entities: { collection: RemoteCollection; entityId: string; data: unknown | null }[]) {
        const ops = entities.map(toLocal).filter((op): op is EntityOp => op !== null);
        // Deletes need no validation; a deleted meta/order has nothing to apply.
        const deletes = entities.filter((e) => e.data === null && e.collection !== 'meta' && e.collection !== 'order')
            .map((e) => ({ collection: e.collection as DiffCollection, entityId: e.entityId, data: null }));
        const all = [...ops.filter((op) => op.data !== null), ...deletes];
        if (all.length === 0) {
            return;
        }
        const applied = mutate(t('live.remoteChange'), (draft) => {
            applyOps(draft as Project, all);
        }, { remote: true });
        if (!applied) {
            console.warn('live: remote change rejected locally', all.map((op) => `${op.collection}:${op.entityId}`));
        }
    }

    private onBriefing(message: BriefingMessage) {
        const live = useLive.getState();
        if (!live.following || message.from !== live.leaderId) {
            return;
        }
        void import('../../features/briefing/briefing').then(({ goToPhase }) => {
            if (useUi.getState().mode !== 'briefing') {
                void import('../../features/workspace/modes').then(({ setMode }) => setMode('briefing'));
            }
            goToPhase(message.phaseIndex, true);
            if (message.camera) {
                const { center, zoom, bearing } = message.camera;
                mapRef.current?.easeTo({ center, zoom, bearing, duration: 600 });
            }
        });
    }

    async close() {
        stopCameraShare?.();
        stopCameraShare = null;
        this.stop.forEach((fn) => fn());
        this.stop = [];
        window.clearTimeout(this.seqTimer);
        await db.liveLinks.update(this.link.projectId, { lastSeq: this.lastSeq }).catch(() => undefined);
        setBriefingSender(null, () => null);
        this.transport.close();
    }
}

let session: Session | null = null;

export function liveSession(): Session | null {
    return session;
}

/** Connect the open plan if it is linked to a live plan (called when the workspace opens). */
export async function connectLive(projectId: string): Promise<void> {
    await disconnectLive();
    const link = await db.liveLinks.get(projectId);
    if (!link || (link.backend === 'supabase' && !supabaseConfigured())) {
        return;
    }
    const backend = backendFor(link.backend);
    // Another account on this device (or another tab in test mode) never syncs this copy.
    if ((await backend.userId()) !== link.userId) {
        useLive.setState({ status: 'off', error: 'other-account' });
        return;
    }
    const next = new Session(link, backend.open(link.remoteId));
    session = next;
    try {
        await next.start();
    } catch (error) {
        console.warn('live: connect failed', error);
        useLive.setState({ status: 'offline', error: String(error) });
    }
}

export async function disconnectLive(): Promise<void> {
    const current = session;
    session = null;
    if (current) {
        await current.close();
    }
    resetLive();
}

/** Publish the open plan as a new live plan (this device becomes its owner). */
export async function goLive(kind: 'supabase' | 'loopback'): Promise<void> {
    const project = useProject.getState().project;
    if (!project || useProject.getState().readOnly) {
        return;
    }
    await flushNow();
    const backend = backendFor(kind);
    const userId = await backend.userId();
    if (!userId) {
        throw new Error('unauthenticated');
    }
    const remoteId = await backend.createPlan(project.name, project.areaId, displayName());
    const link: LiveLinkRow = { projectId: project.id, remoteId, role: 'owner', backend: kind, lastSeq: 0, name: project.name, userId };
    await db.liveLinks.put(link);
    await saveProject(project);
    await connectLive(project.id);
    await session?.enqueue(snapshotOps(project));
}

/** Join with an invite code: download the live plan, store it locally and open it. */
export async function joinLive(code: string, kind: 'supabase' | 'loopback'): Promise<{ project: Project; info: JoinInfo }> {
    const backend = backendFor(kind);
    const userId = await backend.userId();
    if (!userId) {
        throw new Error('unauthenticated');
    }
    const info = await backend.redeem(code, displayName());
    // Reuse this account's existing copy of the plan; other accounts get their own copy.
    const existing = (await db.liveLinks.where('remoteId').equals(info.planId).toArray()).find((link) => link.userId === userId);
    if (existing) {
        await db.liveLinks.update(existing.projectId, { role: existing.role === 'owner' ? 'owner' : info.role });
        const stored = await db.projects.get(existing.projectId);
        if (stored) {
            return { project: stored.data, info };
        }
    }
    const entities = await backend.open(info.planId).pull(0);
    const project = projectFromEntities(entities, info);
    await saveProject(project);
    await db.liveLinks.put({ projectId: project.id, remoteId: info.planId, role: info.role, backend: kind, lastSeq: Math.max(0, ...entities.map((e) => e.seq)), name: info.name, userId });
    return { project, info };
}

/** Stop syncing this plan on this device; the local copy stays. */
export async function unlinkLive(projectId: string): Promise<void> {
    await disconnectLive();
    await db.liveLinks.delete(projectId);
    await db.outbox.where('projectId').equals(projectId).delete();
    if (useProject.getState().readOnly === 'viewer') {
        useProject.getState().setReadOnly(false);
    }
}

export async function createInvite(role: 'admin' | 'viewer'): Promise<string> {
    if (!session) {
        throw new Error('offline');
    }
    return session.transport.createInvite(role);
}

export async function sendChat(body: string): Promise<void> {
    const text = body.trim().slice(0, 1000);
    if (session && text && session.role !== 'viewer') {
        await session.transport.sendChat(text);
    }
}

let stopCameraShare: (() => void) | null = null;

/** Lead the briefing: phase changes and (throttled) map moves go to everyone following. */
export function setLeading(on: boolean) {
    if (!session || session.role === 'viewer') {
        return;
    }
    session.leading = on;
    session.track();
    useLive.setState({ leaderId: on ? session.clientId : null, following: false });
    stopCameraShare?.();
    stopCameraShare = null;
    const map = mapRef.current;
    if (on && map) {
        let timer = 0;
        const share = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void import('./briefingSync').then(({ broadcastBriefing }) => broadcastBriefing()), 250);
        };
        map.on('moveend', share);
        stopCameraShare = () => {
            window.clearTimeout(timer);
            map.off('moveend', share);
        };
        void import('./briefingSync').then(({ broadcastBriefing }) => broadcastBriefing());
    }
}

export function setFollowing(on: boolean) {
    useLive.setState({ following: on });
}

export function myClientId(): string | null {
    return session?.clientId ?? null;
}

/** Re-apply my version of a clashing object on top of the current server state. */
export function resolveConflict(id: string, keepMine: boolean) {
    const conflict = useLive.getState().conflicts.find((c) => c.id === id);
    useLive.setState({ conflicts: useLive.getState().conflicts.filter((c) => c.id !== id) });
    if (!conflict || !keepMine || !session || session.role === 'viewer') {
        return;
    }
    const op = toLocal({ collection: conflict.collection, entityId: conflict.entityId, data: conflict.mine });
    const remove = conflict.mine === null && conflict.collection !== 'meta' && conflict.collection !== 'order';
    mutate(t('live.keepMine'), (draft) => {
        applyOps(draft as Project, remove ? [{ collection: conflict.collection as DiffCollection, entityId: conflict.entityId, data: null }] : op ? [op] : []);
    });
}
