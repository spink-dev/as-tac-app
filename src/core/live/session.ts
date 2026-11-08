import { db, kvGet, kvSet, type LiveLinkRow, type OutboxRow } from '../storage/db';
import { getAsset, putVerifiedAsset, safeMime, sha256Hex } from '../storage/assets';
import { flushNow, saveProject } from '../storage/projects';
import { mutate, onProjectChange, useProject } from '../store/project';
import { applyOps, diffProjects, entityOf, metaOf, ORDER_ID, type DiffCollection, type EntityOp } from '../store/diff';
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
    // The entity's own id must be the key it travels under (else duplicates would break the plan).
    if (entity.data !== null && (!validEntity(entity.collection, entity.data) || (entity.data as { id?: unknown }).id !== entity.entityId)) {
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

/** Stable JSON comparison (key order independent) for telling a real clash from a lost ack. */
function same(a: unknown, b: unknown): boolean {
    const stable = (value: unknown) => JSON.stringify(value, (_key, v) => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
        : v));
    return a === b || stable(a ?? null) === stable(b ?? null);
}

/** Errors that will fail again unchanged (constraint, validation, oversize) — unlike network trouble. */
function permanentError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /violates|constraint|invalid input|batch|limit|too large|payload|22\d\d\d|23\d\d\d/i.test(message);
}

const versionsKey = (projectId: string) => `live:v:${projectId}`;
const MAX_BATCH_BYTES = 1_500_000;

class Session {
    readonly clientId = uid('c');
    readonly versions = new Map<string, number>();
    readonly pending = new Map<string, OutboxRow>();
    readonly inflight = new Map<string, OutboxRow>();
    lastSeq: number;
    leading = false;
    private closed = false;
    private subscribed = false;
    private flushing = false;
    private isolate = false;
    private retry = 0;
    private order = 0;
    private timers = new Set<number>();
    private seenAbove = new Set<number>();
    private persistChain: Promise<unknown> = Promise.resolve();
    private uploaded = new Set<string>();
    private stop: (() => void)[] = [];
    private demoted = false;

    constructor(readonly link: LiveLinkRow, readonly transport: LiveTransport) {
        this.lastSeq = link.lastSeq;
    }

    get role(): LiveRole {
        return this.link.role;
    }

    private later(fn: () => void, ms: number): number {
        const id = window.setTimeout(() => {
            this.timers.delete(id);
            if (!this.closed) {
                fn();
            }
        }, ms);
        this.timers.add(id);
        return id;
    }

    /** Capture local edits right away (also offline); connecting happens in the background. */
    async start() {
        useLive.setState({ status: 'connecting', backend: this.link.backend, remoteId: this.link.remoteId, role: this.role, error: null });
        if (this.role === 'viewer') {
            useProject.getState().setReadOnly('viewer');
        }
        const stored = await kvGet<Record<string, number>>(versionsKey(this.link.projectId), {});
        for (const [key, version] of Object.entries(stored)) {
            this.versions.set(key, version);
        }
        for (const row of (await db.liveOutbox.where('projectId').equals(this.link.projectId).toArray()).sort((a, b) => a.order - b.order)) {
            this.pending.set(keyOf(row.collection, row.entityId), row);
            this.order = Math.max(this.order, row.order);
        }
        if (this.closed) {
            return;
        }
        useLive.setState({ queued: this.pending.size });
        this.stop.push(onProjectChange((prev, next, source) => this.onLocal(prev, next, source)));
        setBriefingSender((state) => {
            if (this.leading && !this.closed) {
                this.transport.broadcast({ type: 'briefing', from: this.clientId, phaseIndex: state.phaseIndex, camera: state.camera });
            }
        }, () => ({ phaseIndex: useUi.getState().phaseIndex, camera: mapRef.current ? currentCamera(mapRef.current) : null }));
        const onOnline = () => void (this.subscribed ? this.catchUp() : this.connect());
        window.addEventListener('online', onOnline);
        this.stop.push(() => window.removeEventListener('online', onOnline));
        void this.connect();
    }

    private async connect() {
        if (this.closed || this.subscribed) {
            return;
        }
        try {
            await Promise.race([
                this.transport.subscribe({
                    entity: (entity) => this.onRemote(entity),
                    presence: (people) => this.onPresence(people),
                    briefing: (message) => this.onBriefing(message),
                    chat: (message) => {
                        if (this.closed) {
                            return;
                        }
                        const { chat, unread } = useLive.getState();
                        if (!chat.some((m) => m.id === message.id)) {
                            const open = useUi.getState().panel === 'live' && useUi.getState().sheet !== 'closed';
                            useLive.setState({ chat: [...chat.slice(-199), message], unread: open ? 0 : unread + 1 });
                        }
                    },
                    status: (online) => {
                        if (this.closed) {
                            return;
                        }
                        useLive.setState({ status: online ? 'online' : 'offline' });
                        if (online) {
                            void this.catchUp();
                        }
                    },
                }),
                new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 15000)),
            ]);
        } catch (error) {
            console.warn('live: connect failed', error);
            if (!this.closed) {
                useLive.setState({ status: 'offline' });
                this.scheduleRetry(() => this.connect());
            }
            return;
        }
        if (this.closed) {
            return;
        }
        this.subscribed = true;
        this.track();
        if (this.role !== 'viewer') {
            void this.transport.chatHistory().then((chat) => !this.closed && useLive.setState({ chat })).catch(() => undefined);
        }
    }

    private scheduleRetry(fn: () => void) {
        this.retry = Math.min(this.retry + 1, 6);
        this.later(fn, 1000 * 2 ** this.retry);
    }

    track() {
        if (!this.closed) {
            this.transport.track({ clientId: this.clientId, name: displayName(), role: this.role, color: colorFor(this.clientId), leading: this.leading });
        }
    }

    private onPresence(people: Presence[]) {
        if (this.closed) {
            return;
        }
        // Roles in the list come from the membership, not from what a client claims (transport).
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
    }

    /** Pull everything since the last contiguous sequence, then send what waited offline. */
    async catchUp() {
        if (this.closed) {
            return;
        }
        try {
            const entities = await this.transport.pull(this.lastSeq);
            if (this.closed) {
                return;
            }
            for (const entity of entities) {
                this.onRemote(entity);
            }
            useLive.setState({ status: 'online' });
            this.retry = 0;
            await this.flush();
            void this.ensureAssets();
        } catch (error) {
            console.warn('live: catch-up failed', error);
            if (!this.closed) {
                useLive.setState({ status: 'offline' });
                this.scheduleRetry(() => this.catchUp());
            }
        }
    }

    private onLocal(prev: Project | null, next: Project | null, source: string) {
        if (this.closed || !prev || !next || source === 'remote' || source === 'load' || next.id !== this.link.projectId || this.role === 'viewer') {
            return;
        }
        const ops = diffProjects(prev, next, SYNCED_COLLECTIONS);
        if (ops.length > 0) {
            this.enqueue(ops.map((op) => ({ ...toRemote(op), prev: entityOf(prev, op) ?? null })));
        }
    }

    /** Synchronous: the pending map is always current; Dexie writes follow in order. */
    enqueue(ops: (Omit<PushOp, 'base'> & { prev?: unknown | null })[]) {
        const now = new Date().toISOString();
        for (const op of ops) {
            const key = keyOf(op.collection, op.entityId);
            const existing = this.pending.get(key);
            // Repeated edits of one entity before sending collapse into one op with the original base.
            const row: OutboxRow = existing
                ? { ...existing, data: op.data, createdAt: now }
                : {
                    id: `${this.link.projectId}|${key}`, projectId: this.link.projectId, collection: op.collection, entityId: op.entityId,
                    data: op.data, prev: op.prev ?? null, base: this.versions.get(key) ?? 0, order: ++this.order, clientId: this.clientId, createdAt: now,
                };
            this.pending.set(key, row);
            this.persist(row);
        }
        useLive.setState({ queued: this.pending.size });
        void this.flush();
    }

    private persist(row: OutboxRow) {
        this.persistChain = this.persistChain.then(() => db.liveOutbox.put(row)).catch((error) => console.warn('live: outbox write failed', error));
    }

    private forget(row: OutboxRow) {
        this.persistChain = this.persistChain.then(() => db.liveOutbox.delete(row.id)).catch(() => undefined);
    }

    private saveVersions() {
        window.clearTimeout(this.versionTimer);
        this.versionTimer = window.setTimeout(() => {
            void kvSet(versionsKey(this.link.projectId), Object.fromEntries(this.versions));
            void db.liveLinks.update(this.link.projectId, { lastSeq: this.lastSeq });
        }, 800);
    }
    private versionTimer = 0;

    private nextBatch(): OutboxRow[] {
        const rows = [...this.pending.values()].sort((a, b) => a.order - b.order);
        if (this.isolate) {
            return rows.slice(0, 1);
        }
        const batch: OutboxRow[] = [];
        let bytes = 0;
        for (const row of rows) {
            const size = JSON.stringify(row.data ?? null).length;
            if (batch.length > 0 && (batch.length >= BATCH || bytes + size > MAX_BATCH_BYTES)) {
                break;
            }
            batch.push(row);
            bytes += size;
        }
        return batch;
    }

    async flush(): Promise<void> {
        if (this.flushing || this.closed || !this.subscribed || useLive.getState().status !== 'online') {
            return;
        }
        this.flushing = true;
        let batch: OutboxRow[] = [];
        try {
            while (this.pending.size > 0 && !this.closed) {
                batch = this.nextBatch();
                await this.uploadAssets(batch);
                const sent = new Map(batch.map((row) => [keyOf(row.collection, row.entityId), row]));
                sent.forEach((row, key) => this.inflight.set(key, row));
                const result = await this.transport.push(batch.map((row) => ({ collection: row.collection as RemoteCollection, entityId: row.entityId, data: row.data, base: row.base })), this.clientId);
                this.inflight.clear();
                if (this.closed) {
                    return;
                }
                for (const applied of result.applied) {
                    const key = keyOf(applied.collection, applied.entityId);
                    this.versions.set(key, Math.max(this.versions.get(key) ?? 0, applied.version));
                    this.markSeq(applied.seq);
                    this.settle(key, sent.get(key), applied.version);
                }
                for (const conflict of result.conflicts) {
                    const key = keyOf(conflict.collection, conflict.entityId);
                    const row = sent.get(key);
                    this.versions.set(key, conflict.version);
                    if (!row) {
                        continue;
                    }
                    if (same(conflict.data, row.data)) {
                        // My write had already landed (lost acknowledgement): nothing clashed.
                        this.settle(key, row, conflict.version);
                    } else if (same(conflict.data, row.prev)) {
                        // The server still holds exactly what I edited from; only my base was stale.
                        const current = this.pending.get(key) ?? row;
                        current.base = conflict.version;
                        this.persist(current);
                    } else {
                        // A real clash: the server value applies, mine is offered to the user.
                        const mine = this.pending.get(key)?.data ?? row.data;
                        const current = this.pending.get(key);
                        if (current) {
                            this.pending.delete(key);
                            this.forget(current);
                        }
                        this.applyRemote([{ collection: conflict.collection, entityId: conflict.entityId, data: conflict.data }]);
                        this.surface({ collection: conflict.collection, entityId: conflict.entityId, mine });
                    }
                }
                this.saveVersions();
                useLive.setState({ queued: this.pending.size });
                this.retry = 0;
                this.isolate = false;
            }
        } catch (error) {
            this.inflight.clear();
            if (this.closed) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            console.warn('live: push failed', message);
            if (message === 'forbidden') {
                await this.demote();
            } else if (permanentError(error)) {
                if (batch.length > 1) {
                    // Find the one bad change by sending one at a time.
                    this.isolate = true;
                    this.later(() => void this.flush(), 0);
                } else if (batch[0]) {
                    this.quarantine(batch[0]);
                    this.later(() => void this.flush(), 0);
                }
            } else {
                useLive.setState({ status: 'offline' });
                this.scheduleRetry(() => this.catchUp());
            }
        } finally {
            this.flushing = false;
        }
    }

    /** After the server accepted (or already had) my row for `key`. */
    private settle(key: string, sent: OutboxRow | undefined, version: number) {
        const current = this.pending.get(key);
        if (current && current === sent) {
            this.pending.delete(key);
            this.forget(current);
        } else if (current) {
            // Edited again while in flight: that edit builds on what was just accepted.
            current.base = version;
            current.prev = sent?.data ?? current.prev;
            this.persist(current);
        }
    }

    /** A change the server can never accept: drop it from the queue and say so. */
    private quarantine(row: OutboxRow) {
        const key = keyOf(row.collection, row.entityId);
        if (this.pending.get(key) === row) {
            this.pending.delete(key);
            this.forget(row);
        }
        useLive.setState({ queued: this.pending.size });
        toast(t('live.rejected', { name: labelFor(row.collection as RemoteCollection, row.data) }), { tone: 'danger' });
    }

    /** Role lowered on the server: drop queued writes and restore the server state of those objects. */
    private async demote() {
        const keys = [...this.pending.keys()];
        this.link.role = 'viewer';
        await db.liveLinks.put(this.link);
        for (const row of this.pending.values()) {
            this.forget(row);
        }
        this.pending.clear();
        useProject.getState().setReadOnly('viewer');
        useLive.setState({ role: 'viewer', queued: 0 });
        if (!this.demoted) {
            this.demoted = true;
            toast(t('live.nowViewer'), { tone: 'warn' });
        }
        try {
            const all = await this.transport.pull(0);
            const wanted = new Set(keys);
            for (const entity of all) {
                const key = keyOf(entity.collection, entity.entityId);
                if (wanted.has(key)) {
                    this.versions.delete(key);
                    this.onRemote(entity);
                }
            }
        } catch {
            // Next catch-up brings them.
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
                // Only real images go to the shared bucket (passive types only).
                if (asset && asset.mime.startsWith('image/')) {
                    await this.transport.uploadAsset(hash, asset.blob);
                }
                this.uploaded.add(hash);
            }
        }
    }

    /** Fetch image maps and logos this device doesn't have yet (join, reconnect, new images). */
    private async ensureAssets() {
        const project = useProject.getState().project;
        if (!project || project.id !== this.link.projectId) {
            return;
        }
        const wanted = [
            ...project.images.map((image) => ({ hash: image.asset, mime: image.mime })),
            ...project.teams.filter((team) => team.logoAsset).map((team) => ({ hash: team.logoAsset!, mime: undefined })),
        ];
        for (const { hash, mime } of wanted) {
            if (this.closed) {
                return;
            }
            await this.ensureAsset(hash, mime);
        }
    }

    private async ensureAsset(hash: string | undefined, mime: string | undefined) {
        if (!hash || await getAsset(hash)) {
            return;
        }
        const blob = await this.transport.downloadAsset(hash).catch(() => null);
        if (!blob || blob.size > 40 * 1024 * 1024 || this.closed) {
            return;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        // Content-addressed: anything that doesn't hash to its name is dropped.
        if ((await sha256Hex(bytes)) === hash) {
            await putVerifiedAsset(hash, bytes, safeMime(mime ?? blob.type));
            renderPlan();
        }
    }

    /** Track the contiguous sequence; a gap (missed realtime event) is filled by a catch-up. */
    private markSeq(seq: number) {
        if (seq <= this.lastSeq) {
            return;
        }
        this.seenAbove.add(seq);
        while (this.seenAbove.has(this.lastSeq + 1)) {
            this.seenAbove.delete(this.lastSeq + 1);
            this.lastSeq += 1;
        }
        if (this.seenAbove.size > 0 && !this.gapTimer) {
            this.gapTimer = this.later(() => {
                this.gapTimer = 0;
                if (this.seenAbove.size > 0) {
                    void this.catchUp();
                }
            }, 2000);
        }
        this.saveVersions();
    }
    private gapTimer = 0;

    private onRemote(entity: RemoteEntity) {
        if (this.closed) {
            return;
        }
        this.markSeq(entity.seq);
        const key = keyOf(entity.collection, entity.entityId);
        if (entity.version <= (this.versions.get(key) ?? 0)) {
            return;
        }
        // Own echo, or a local edit still waiting: the server decides that one (version check).
        if (entity.clientId === this.clientId || this.pending.has(key) || this.inflight.has(key)) {
            this.versions.set(key, entity.version);
            return;
        }
        if (!this.applyRemote([entity])) {
            // Not applied here (invalid for this device): keep the old version so it is retried, not assumed.
            return;
        }
        this.versions.set(key, entity.version);
        this.saveVersions();
        const data = entity.data as { asset?: string; logoAsset?: string; mime?: string } | null;
        if (entity.collection === 'images') {
            void this.ensureAsset(data?.asset, data?.mime);
        } else if (entity.collection === 'teams') {
            void this.ensureAsset(data?.logoAsset, undefined);
        }
    }

    /** Apply server state to the open plan — only if it is this session's plan. */
    applyRemote(entities: { collection: RemoteCollection; entityId: string; data: unknown | null }[]): boolean {
        if (this.closed || useProject.getState().project?.id !== this.link.projectId) {
            return false;
        }
        const deletes = entities.filter((e) => e.data === null && e.collection !== 'meta' && e.collection !== 'order')
            .map((e) => ({ collection: e.collection as DiffCollection, entityId: e.entityId, data: null }));
        const ops = entities.filter((e) => e.data !== null).map(toLocal).filter((op): op is EntityOp => op !== null);
        const all = [...ops, ...deletes];
        if (all.length === 0) {
            return entities.every((e) => e.data === null);
        }
        const applied = mutate(t('live.remoteChange'), (draft) => {
            applyOps(draft as Project, all);
        }, { remote: true });
        if (!applied) {
            const current = useProject.getState().project;
            // A no-op (already equal) is fine; a rejection is not.
            const unchanged = current && all.every((op) => same(entityOf(current, op) ?? null, op.data));
            if (!unchanged) {
                console.warn('live: remote change rejected locally', all.map((op) => `${op.collection}:${op.entityId}`));
                return false;
            }
        }
        return true;
    }

    private onBriefing(message: BriefingMessage) {
        const live = useLive.getState();
        if (this.closed || !live.following || message.from !== live.leaderId || !Number.isInteger(message.phaseIndex) || message.phaseIndex < 0) {
            return;
        }
        const camera = message.camera;
        const validCamera = camera && Array.isArray(camera.center) && camera.center.every(Number.isFinite) && Number.isFinite(camera.zoom) && Number.isFinite(camera.bearing);
        void import('../../features/briefing/briefing').then(({ goToPhase }) => {
            if (this.closed) {
                return;
            }
            if (useUi.getState().mode !== 'briefing') {
                void import('../../features/workspace/modes').then(({ setMode }) => setMode('briefing'));
            }
            goToPhase(message.phaseIndex, true);
            if (validCamera) {
                mapRef.current?.easeTo({ center: camera.center, zoom: camera.zoom, bearing: camera.bearing, duration: 600 });
            }
        });
    }

    async close() {
        this.closed = true;
        stopCameraShare?.();
        stopCameraShare = null;
        this.stop.forEach((fn) => fn());
        this.stop = [];
        this.timers.forEach((id) => window.clearTimeout(id));
        this.timers.clear();
        window.clearTimeout(this.versionTimer);
        await this.persistChain;
        await kvSet(versionsKey(this.link.projectId), Object.fromEntries(this.versions)).catch(() => undefined);
        await db.liveLinks.update(this.link.projectId, { lastSeq: this.lastSeq }).catch(() => undefined);
        setBriefingSender(null, () => null);
        this.transport.close();
    }
}

let session: Session | null = null;
let generation = 0;

export function liveSession(): Session | null {
    return session;
}

async function stopSession() {
    const current = session;
    session = null;
    if (current) {
        await current.close();
    }
    resetLive();
}

/** Connect the open plan if it is linked to a live plan (called when the workspace opens). */
export async function connectLive(projectId: string): Promise<void> {
    const token = ++generation;
    await stopSession();
    const link = await db.liveLinks.get(projectId);
    if (token !== generation || !link || (link.backend === 'supabase' && !supabaseConfigured())) {
        return;
    }
    // Viewers stay read-only even before (or without) a connection.
    if (link.role === 'viewer') {
        useProject.getState().setReadOnly('viewer');
    }
    const backend = backendFor(link.backend);
    const userId = await backend.userId();
    if (token !== generation) {
        return;
    }
    // Another account on this device (or another tab in test mode) never syncs this copy.
    if (userId !== link.userId) {
        useLive.setState({ status: 'off', error: 'other-account' });
        return;
    }
    const next = new Session(link, backend.open(link.remoteId));
    session = next;
    try {
        await next.start();
    } catch (error) {
        console.warn('live: start failed', error);
        useLive.setState({ status: 'offline', error: String(error) });
    }
}

export async function disconnectLive(): Promise<void> {
    generation += 1;
    await stopSession();
}

/** Publish the open plan as a new live plan (this device becomes its owner). */
export async function goLive(kind: 'supabase' | 'loopback'): Promise<void> {
    const before = useProject.getState().project;
    if (!before || useProject.getState().readOnly) {
        return;
    }
    await flushNow();
    const backend = backendFor(kind);
    const userId = await backend.userId();
    if (!userId) {
        throw new Error('unauthenticated');
    }
    const remoteId = await backend.createPlan(before.name, before.areaId, displayName());
    const link: LiveLinkRow = { projectId: before.id, remoteId, role: 'owner', backend: kind, lastSeq: 0, name: before.name, userId };
    await db.liveLinks.put(link);
    await connectLive(before.id);
    // Snapshot what is open now (edits made while creating the plan included).
    const project = useProject.getState().project;
    if (project && project.id === before.id) {
        await saveProject(project);
        session?.enqueue(snapshotOps(project));
    }
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
    // The versions this copy is based on, so the first edit isn't mistaken for a clash.
    await kvSet(versionsKey(project.id), Object.fromEntries(entities.map((e) => [keyOf(e.collection, e.entityId), e.version])));
    await db.liveLinks.put({ projectId: project.id, remoteId: info.planId, role: info.role, backend: kind, lastSeq: Math.max(0, ...entities.map((e) => e.seq)), name: info.name, userId });
    return { project, info };
}

/** Stop syncing this plan on this device; the local copy stays (unsent changes are dropped). */
export async function unlinkLive(projectId: string): Promise<void> {
    await disconnectLive();
    await db.liveLinks.delete(projectId);
    await db.liveOutbox.where('projectId').equals(projectId).delete();
    await db.kv.delete(versionsKey(projectId));
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
