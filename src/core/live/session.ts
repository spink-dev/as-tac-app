import { db, kvGet, kvSet, type LiveLinkRow, type OutboxRow } from '../storage/db';
import { getAsset, isRenderableImage, putVerifiedAsset, safeMime, sha256Hex } from '../storage/assets';
import { mayAutoDownload } from '../net';
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
import { broadcastBriefing, setBriefingSender } from './briefingSync';
import { currentCamera, mapRef, renderPlan } from '../../map/MapView';
import { LoopbackBackend } from './loopback';
import { SupabaseBackend, supabaseConfigured } from './supabase';
import type { BriefingMessage, JoinInfo, LiveBackend, LiveTransport, PushOp, PushResult, RemoteCollection, RemoteEntity } from './types';

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
/*
 * Weak mobile links: requests are small and resumable. Pushes start at 64 KB and grow while
 * they go through quickly; a timeout or drop shrinks them. Catch-up pulls come in pages whose
 * size adapts the same way, and each page is applied and remembered before the next one, so a
 * dropped connection continues where it stopped instead of starting over.
 */
const BUDGET_MIN = 8 * 1024;
const BUDGET_START = 64 * 1024;
const BUDGET_MAX = 1_500_000;
const PAGE_START = 200;
const PAGE_MAX = 1000;
/** Bytes per row, for deadlines: a first guess, then learned from what arrives. */
const ROW_GUESS = 600;
const ROW_MIN = 200;
const ROW_MAX = 2_000_000;
/** Edits within this window go out together (typing, dragging). */
const FLUSH_DELAY_MS = 250;
/** Without realtime (websocket blocked or dropping), changes are fetched this often over HTTP. */
const POLL_MS = 20000;
/** With realtime up, a rare missed message is still picked up within this time. */
const SAFETY_POLL_MS = 60000;
/**
 * Every request gets a deadline: base time plus a floor of about 0.5 KB/s for its size. On
 * Supabase a request that receives nothing for 30 s is cut earlier (see `stallFetch`), so this
 * is only the outer limit; sizes come from what was actually seen.
 */
const deadline = (bytes: number) => 15000 + bytes * 2;
/** A leader re-announces itself this often; silence for the timeout ends its leadership. */
const LEADER_HEARTBEAT_MS = 5000;
const LEADER_TIMEOUT_MS = 15000;
const broadcastNow = () => broadcastBriefing();

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

/**
 * Coordinates and other fractions travel with 7 decimals (about 1 cm): map clicks produce 15+
 * digits that only cost bytes. Applied to data and to the base it was edited from, so the
 * version checks compare like with like.
 */
export function wire(value: unknown): unknown {
    if (typeof value === 'number') {
        return Number.isInteger(value) || !Number.isFinite(value) ? value : Math.round(value * 1e7) / 1e7;
    }
    if (Array.isArray(value)) {
        return value.map(wire);
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            out[key] = wire(item);
        }
        return out;
    }
    return value;
}

/** Run a request with a deadline; running out of time counts as network trouble. */
async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const cancel = () => controller.abort();
    outer?.addEventListener('abort', cancel, { once: true });
    try {
        return await run(controller.signal);
    } catch (error) {
        // `restart`: asked to start over (network back); `timeout`: ran out of time.
        throw outer?.aborted ? new Error('restart') : controller.signal.aborted ? new Error('timeout') : error;
    } finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', cancel);
    }
}

/** Average size of a row in a page (for request deadlines), learned from what arrives. */
function rowSize(page: RemoteEntity[]): number {
    return page.length ? JSON.stringify(page).length / page.length : 0;
}

/**
 * Download a whole live plan page by page (join, role change). Pages shrink and are retried on
 * a weak connection instead of failing the whole download; the newest version per object wins.
 */
export async function pullAll(transport: LiveTransport, onProgress?: (count: number) => void, signal?: AbortSignal): Promise<RemoteEntity[]> {
    const latest = new Map<string, RemoteEntity>();
    let since = 0;
    let limit = PAGE_START;
    let bytesPerRow = ROW_GUESS;
    let failures = 0;
    while (true) {
        signal?.throwIfAborted();
        const started = Date.now();
        let page: RemoteEntity[];
        try {
            page = await withDeadline((inner) => transport.pull(since, { limit, signal: inner }), deadline(limit * bytesPerRow), signal);
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            if (signal?.aborted || failures >= 6 || permanentError(error) || ['forbidden', 'unauthenticated'].includes(message)) {
                throw error;
            }
            failures += 1;
            // Smaller pages, and assume bigger rows (long routes, drawings) next time.
            limit = Math.max(1, Math.floor(limit / 2));
            if (message === 'timeout') {
                bytesPerRow = Math.min(ROW_MAX, bytesPerRow * 4);
            }
            await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** failures));
            continue;
        }
        failures = 0;
        for (const entity of page) {
            latest.set(keyOf(entity.collection, entity.entityId), entity);
        }
        bytesPerRow = page.length ? Math.max(ROW_MIN, rowSize(page)) : bytesPerRow;
        onProgress?.(latest.size);
        if (page.length < limit) {
            return [...latest.values()];
        }
        since = Math.max(since, ...page.map((entity) => entity.seq));
        if (Date.now() - started < 3000) {
            limit = Math.min(PAGE_MAX, limit * 2);
        }
    }
}

/** Errors that will fail again unchanged (constraint, validation, oversize) — unlike network trouble. */
function permanentError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /violates|constraint|invalid input|batch|limit|too large|payload|22\d\d\d|23\d\d\d/i.test(message);
}

const versionsKey = (projectId: string) => `live:v:${projectId}`;

class Session {
    readonly clientId = uid('c');
    readonly versions = new Map<string, number>();
    readonly pending = new Map<string, OutboxRow>();
    readonly inflight = new Map<string, OutboxRow>();
    lastSeq: number;
    leading = false;
    private closed = false;
    private subscribed = false;
    /** Realtime channel currently delivering (vs. HTTP only). */
    private realtime = false;
    /** The last request to the server got through. */
    private httpOk = false;
    private flushing = false;
    private flushTimer = 0;
    private pulling = false;
    private pullAgain = false;
    private pollTimer = 0;
    private budget = BUDGET_START;
    private pageSize = PAGE_START;
    private rowBytes = ROW_GUESS;
    /** Highest seq of my own writes the server confirmed. */
    private ownSeqMax = 0;
    private pullRestart: AbortController | null = null;
    /** Aborted on close: ends waits and downloads of this session. */
    private readonly life = new AbortController();
    /** Pictures being downloaded, and when a failed one may be tried again. */
    private assetJobs = new Map<string, Promise<void>>();
    private assetRetry = new Map<string, { at: number; wait: number }>();
    /** Pictures to put on the server, sent one at a time in the background. */
    private uploadQueue = new Set<string>();
    /** Uploads that failed and wait for their retry (restarted early when the link comes back). */
    private failedUploads = new Set<string>();
    private uploading = false;
    private ensureTimer = 0;
    private progressAt = 0;
    private ownPicturesQueued = false;
    /** The first realtime connect attempt has finished (until then: «connecting»). */
    private connectSettled = false;
    private isolate = false;
    private retry = 0;
    private order = 0;
    private timers = new Set<number>();
    private seenAbove = new Set<number>();
    /** Partner changes that arrived while my push of the same object was in flight. */
    private deferred = new Map<string, RemoteEntity>();
    private leaderSeen = 0;
    /** Last phase/camera applied while following: heartbeats that change nothing move nobody. */
    private lastApplied: string | null = null;
    /** Set while stepping back for another leader, so followers are handed over to them. */
    private yieldTo: string | null = null;
    /** Highest seq that may be stored: an entity this device couldn't apply is pulled again next time. */
    private holdSeq = Number.POSITIVE_INFINITY;
    private leaderTimer = 0;
    private heartbeat = 0;
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
                this.transport.broadcast({ type: 'briefing', from: this.clientId, name: displayName(), leading: true, phaseIndex: state.phaseIndex, camera: state.camera });
            }
        }, () => ({ phaseIndex: useUi.getState().phaseIndex, camera: mapRef.current ? currentCamera(mapRef.current) : null }));
        // Leaving the briefing ends leading and following (no one is pulled back into it).
        this.stop.push(useUi.subscribe((state, prev) => {
            if (state.mode !== prev.mode && state.mode !== 'briefing') {
                if (this.leading) {
                    setLeading(false);
                }
                if (useLive.getState().following) {
                    useLive.setState({ following: false });
                }
            }
        }));
        this.stop.push(useLive.subscribe((state, prev) => {
            if (state.following && !prev.following) {
                this.lastApplied = null;
            }
        }));
        const onOnline = () => {
            this.kick();
            if (!this.subscribed) {
                void this.connect();
            }
        };
        window.addEventListener('online', onOnline);
        this.stop.push(() => window.removeEventListener('online', onOnline));
        // Back from the background (phone locked, app switched): the link may have died meanwhile.
        const onVisible = () => {
            if (!document.hidden) {
                void this.catchUp();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        this.stop.push(() => document.removeEventListener('visibilitychange', onVisible));
        // Switching to automatic downloads, or onto Wi-Fi, fetches what was held back.
        this.stop.push(usePrefs.subscribe((state, prev) => {
            if (state.mediaDownload !== prev.mediaDownload) {
                void this.ensureAssets();
            }
        }));
        const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
        const onConnection = () => void this.ensureAssets();
        connection?.addEventListener?.('change', onConnection);
        this.stop.push(() => connection?.removeEventListener?.('change', onConnection));
        // HTTP does not wait for realtime: a blocked or slow websocket must not delay the data.
        void this.catchUp();
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
                    stale: () => {
                        // A change was announced without its content (too large for realtime): fetch it.
                        if (!this.closed) {
                            this.later(() => void this.catchUp(), 300);
                        }
                    },
                    status: (online) => {
                        if (this.closed) {
                            return;
                        }
                        this.realtime = online;
                        this.connectSettled = true;
                        this.showStatus();
                        // Back online: fetch what was missed. Dropped: keep fetching over HTTP.
                        void this.catchUp();
                    },
                }, { exclude: this.clientId }),
                new Promise((_, reject) => window.setTimeout(() => reject(new Error('timeout')), 30000)),
            ]);
        } catch (error) {
            console.warn('live: connect failed', error);
            if (!this.closed) {
                this.realtime = false;
                this.connectSettled = true;
                this.showStatus();
                this.connectRetry = Math.min(this.connectRetry + 1, 6);
                this.later(() => void this.connect(), 1000 * 2 ** this.connectRetry);
                // Realtime may be blocked (proxy, flaky websocket) while plain HTTP works.
                void this.catchUp();
            }
            return;
        }
        this.connectRetry = 0;
        if (this.closed) {
            return;
        }
        this.subscribed = true;
        this.track();
        if (this.role !== 'viewer') {
            void this.transport.chatHistory().then((chat) => !this.closed && useLive.setState({ chat })).catch(() => undefined);
        }
    }

    private connectRetry = 0;

    /** online = realtime + HTTP; limited = HTTP only (polling); offline = nothing gets through. */
    private showStatus() {
        if (!this.closed) {
            useLive.setState({ status: this.httpOk ? (this.realtime ? 'online' : this.connectSettled ? 'limited' : 'connecting') : this.subscribed || this.retry > 0 ? 'offline' : 'connecting' });
        }
    }

    private timed<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
        return withDeadline(run, ms);
    }

    private scheduleRetry(fn: () => void) {
        this.retry = Math.min(this.retry + 1, 6);
        this.later(fn, 1000 * 2 ** this.retry);
    }

    track() {
        if (!this.closed) {
            this.transport.track({ clientId: this.clientId, name: displayName(), role: this.role, color: colorFor(this.clientId) });
        }
    }

    private onPresence(people: Presence[]) {
        if (this.closed) {
            return;
        }
        // Roles in the list come from the membership, not from what a client claims (transport).
        // Who leads a briefing comes only from admin broadcasts (onBriefing), never from presence.
        useLive.setState({ presence: people });
    }

    /** Leading: announce now and every few seconds, so late joiners learn who leads. */
    setLeading(on: boolean) {
        const was = this.leading;
        this.leading = on;
        window.clearInterval(this.heartbeat);
        this.heartbeat = 0;
        if (on) {
            this.heartbeat = window.setInterval(() => broadcastNow(), LEADER_HEARTBEAT_MS);
        } else if (was && !this.closed) {
            this.transport.broadcast({ type: 'briefing', from: this.clientId, name: displayName(), leading: false, to: this.yieldTo ?? undefined, phaseIndex: 0, camera: null });
        }
    }

    private setLeader(id: string | null, name: string | null) {
        const live = useLive.getState();
        window.clearTimeout(this.leaderTimer);
        this.timers.delete(this.leaderTimer);
        if (!id) {
            if (live.leaderId && live.leaderId !== this.clientId) {
                useLive.setState({ leaderId: null, leaderName: null, following: false });
            }
            return;
        }
        this.leaderSeen = Date.now();
        // A leader that went silent (closed the app, lost signal) stops counting as leading.
        this.leaderTimer = this.later(() => {
            if (useLive.getState().leaderId === id && Date.now() - this.leaderSeen >= LEADER_TIMEOUT_MS) {
                this.setLeader(null, null);
            }
        }, LEADER_TIMEOUT_MS);
        if (live.leaderId === id) {
            if (name && live.leaderName !== name) {
                useLive.setState({ leaderName: name });
            }
            return;
        }
        // A handover (another admin takes over the same briefing) keeps followers following.
        const handover = Boolean(live.leaderId) && live.leaderId !== this.clientId;
        useLive.setState({ leaderId: id, leaderName: name, following: handover ? live.following : false });
        if (handover && live.following) {
            return;
        }
        toast(t('briefing.leaderStarted', { name: name ?? '?' }), {
            action: {
                label: t('briefing.follow'),
                run: () => {
                    useLive.setState({ following: true });
                    void import('../../features/workspace/modes').then(({ setMode }) => setMode('briefing'));
                },
            },
        });
    }

    /**
     * Fetch everything since the last known sequence, page by page, then send what waited.
     * Each page is applied and its position remembered before the next one is requested.
     */
    async catchUp() {
        if (this.closed) {
            return;
        }
        if (this.pulling) {
            this.pullAgain = true;
            return;
        }
        this.pulling = true;
        window.clearTimeout(this.pollTimer);
        this.timers.delete(this.pollTimer);
        let received = 0;
        try {
            do {
                this.pullAgain = false;
                // Everything up to my own latest write is known once a full pass is done:
                // unseen rows at or below it can only be mine (excluded from pulls).
                const ceiling = this.ownSeqMax;
                let complete = false;
                while (!this.closed && !complete) {
                    const limit = this.pageSize;
                    const started = Date.now();
                    const restart = new AbortController();
                    this.pullRestart = restart;
                    let page: RemoteEntity[];
                    try {
                        page = await withDeadline((signal) => this.transport.pull(this.lastSeq, { limit, signal, exclude: this.clientId }), deadline(limit * this.rowBytes), restart.signal);
                    } catch (error) {
                        if (error instanceof Error && error.message === 'restart') {
                            // The network came back while this request hung: ask again right away.
                            continue;
                        }
                        if (error instanceof Error && error.message === 'timeout') {
                            // Rows are bigger than assumed (long routes, drawings): smaller pages with
                            // a longer deadline each (rows ×4, page ÷2: twice the time per request).
                            this.rowBytes = Math.min(ROW_MAX, this.rowBytes * 4);
                            this.pageSize = Math.max(1, Math.floor(this.pageSize / 2));
                        }
                        throw error;
                    } finally {
                        this.pullRestart = null;
                    }
                    if (this.closed) {
                        return;
                    }
                    this.httpOk = true;
                    for (const entity of page) {
                        this.onRemote(entity);
                    }
                    if (page.length > 0) {
                        this.rowBytes = Math.max(ROW_MIN, Math.round(this.rowBytes * 0.5 + rowSize(page) * 0.5));
                        // A page holds every change up to its highest seq (ordered, then limited).
                        this.advanceTo(Math.max(...page.map((entity) => entity.seq)));
                        received += page.length;
                        useLive.setState({ receiving: received });
                    }
                    complete = page.length < limit;
                    // Grow only on full pages that came quickly (idle polls say nothing about the link).
                    if (!complete && Date.now() - started < 3000) {
                        this.pageSize = Math.min(PAGE_MAX, this.pageSize * 2);
                    }
                }
                if (this.closed) {
                    return;
                }
                if (complete) {
                    this.advanceTo(ceiling);
                }
                useLive.setState({ receiving: null });
                this.showStatus();
                // A request for another pass that arrives during this flush is handled by the loop.
                await this.flush();
            } while (this.pullAgain && !this.closed);
            if (this.closed) {
                return;
            }
            if (this.pending.size === 0) {
                // Back off again only once something actually got through.
                this.retry = 0;
            }
            void this.ensureAssets();
            this.resumeUploads();
            if (!this.ownPicturesQueued) {
                this.ownPicturesQueued = true;
                this.queueOwnPictures();
            }
            this.pollTimer = this.later(() => void this.catchUp(), this.realtime ? SAFETY_POLL_MS : POLL_MS);
        } catch (error) {
            console.warn('live: catch-up failed', error);
            if (!this.closed) {
                this.httpOk = false;
                useLive.setState({ receiving: null });
                this.showStatus();
                this.scheduleRetry(() => void this.catchUp());
            }
        } finally {
            this.pulling = false;
        }
    }

    /**
     * The device got a new network connection: a request on the old one is dead, so it is
     * restarted at once. Everything else (realtime flapping, app back in front) only asks for
     * another pass — a slow pull that is still receiving data must never be thrown away.
     */
    private kick() {
        if (this.pullRestart) {
            this.pullRestart.abort();
        } else {
            void this.catchUp();
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
            const data = wire(op.data);
            const row: OutboxRow = existing
                ? { ...existing, data, createdAt: now }
                : {
                    id: `${this.link.projectId}|${key}`, projectId: this.link.projectId, collection: op.collection, entityId: op.entityId,
                    data, prev: wire(op.prev ?? null), base: this.versions.get(key) ?? 0, order: ++this.order, clientId: this.clientId, createdAt: now,
                };
            this.pending.set(key, row);
            this.persist(row);
        }
        useLive.setState({ queued: this.pending.size });
        this.scheduleFlush();
    }

    /** Coalesce bursts (typing, dragging) into one request. */
    private scheduleFlush() {
        if (!this.flushTimer) {
            this.flushTimer = this.later(() => {
                this.flushTimer = 0;
                void this.flush();
            }, FLUSH_DELAY_MS);
        }
    }

    private persist(row: OutboxRow) {
        this.persistChain = this.persistChain.then(() => db.liveOutbox.put(row)).catch((error) => console.warn('live: outbox write failed', error));
    }

    private forget(row: OutboxRow) {
        this.persistChain = this.persistChain.then(() => db.liveOutbox.delete(row.id)).catch(() => undefined);
    }

    /**
     * Remember versions and position — only after the plan itself is stored, so a crash can
     * never leave a position that claims changes the stored plan doesn't have.
     */
    private saveVersions() {
        window.clearTimeout(this.versionTimer);
        this.versionTimer = window.setTimeout(() => void this.writeVersions(), 800);
    }

    private async writeVersions(): Promise<void> {
        const versions = Object.fromEntries(this.versions);
        const lastSeq = this.storedSeq();
        if (!(await flushNow().catch(() => false))) {
            // The plan couldn't be stored: keep the old position, so the next session fetches again.
            return;
        }
        await kvSet(versionsKey(this.link.projectId), versions).catch(() => undefined);
        await db.liveLinks.update(this.link.projectId, { lastSeq }).catch(() => undefined);
    }
    private versionTimer = 0;

    private storedSeq(): number {
        return Math.max(this.link.lastSeq, Math.min(this.lastSeq, this.holdSeq));
    }

    private nextBatch(): OutboxRow[] {
        const rows = [...this.pending.values()].sort((a, b) => a.order - b.order);
        if (this.isolate) {
            return rows.slice(0, 1);
        }
        const batch: OutboxRow[] = [];
        let bytes = 0;
        for (const row of rows) {
            const size = JSON.stringify(row.data ?? null).length;
            if (batch.length > 0 && (batch.length >= BATCH || bytes + size > this.budget)) {
                break;
            }
            batch.push(row);
            bytes += size;
        }
        return batch;
    }

    async flush(): Promise<void> {
        if (this.flushing || this.closed || !this.httpOk) {
            return;
        }
        this.flushing = true;
        let batch: OutboxRow[] = [];
        try {
            while (this.pending.size > 0 && !this.closed) {
                batch = this.nextBatch();
                // Pictures go up in the background: plan edits never wait behind a large upload.
                this.queueUploads(batch);
                const sent = new Map(batch.map((row) => [keyOf(row.collection, row.entityId), row]));
                sent.forEach((row, key) => this.inflight.set(key, row));
                const ops = batch.map((row) => ({ collection: row.collection as RemoteCollection, entityId: row.entityId, data: row.data, base: row.base }));
                const bytes = JSON.stringify(ops).length;
                const started = Date.now();
                let result: PushResult;
                try {
                    result = await this.timed((signal) => this.transport.push(ops, this.clientId, signal), deadline(bytes));
                } catch (error) {
                    // The request may still have landed (only the reply got lost): remember what was
                    // sent, so the retry recognises my own write instead of reporting a clash.
                    if (!permanentError(error) && (error as Error)?.message !== 'forbidden') {
                        for (const [key, row] of sent) {
                            const current = this.pending.get(key);
                            if (current) {
                                current.unacked = [...(current.unacked ?? []).slice(-9), row.data];
                                this.persist(current);
                            }
                        }
                    }
                    throw error;
                }
                this.inflight.clear();
                if (this.closed) {
                    return;
                }
                this.httpOk = true;
                if (Date.now() - started < 3000 && bytes >= this.budget / 2) {
                    this.budget = Math.min(BUDGET_MAX, this.budget * 2);
                }
                for (const applied of result.applied) {
                    const key = keyOf(applied.collection, applied.entityId);
                    this.versions.set(key, Math.max(this.versions.get(key) ?? 0, applied.version));
                    this.ownSeqMax = Math.max(this.ownSeqMax, applied.seq);
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
                    } else if (same(conflict.data, row.prev) || (this.pending.get(key) ?? row).unacked?.some((data) => same(conflict.data, data))) {
                        // The server holds what I edited from, or my own earlier write whose reply got
                        // lost: only my base was stale.
                        const current = this.pending.get(key) ?? row;
                        current.base = conflict.version;
                        current.prev = conflict.data;
                        delete current.unacked;
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
                this.replayDeferred();
            }
            // Isolation (one change per request) ends once the bad change was found or all went out.
            this.isolate = false;
        } catch (error) {
            this.inflight.clear();
            if (this.closed) {
                return;
            }
            this.replayDeferred();
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
                    this.isolate = false;
                    this.later(() => void this.flush(), 0);
                }
            } else {
                // Timeout or dropped connection: smaller requests from now on, then try again.
                this.budget = Math.max(BUDGET_MIN, Math.floor(this.budget / 4));
                this.httpOk = false;
                this.showStatus();
                this.scheduleRetry(() => void this.catchUp());
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
            delete current.unacked;
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
        this.uploadQueue.clear();
        this.failedUploads.clear();
        useProject.getState().setReadOnly('viewer');
        useLive.setState({ role: 'viewer', queued: 0 });
        if (!this.demoted) {
            this.demoted = true;
            toast(t('live.nowViewer'), { tone: 'warn' });
        }
        try {
            const all = await pullAll(this.transport, undefined, this.life.signal);
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

    /** Pictures referenced by these rows (image maps, team logos) go into the upload queue. */
    private queueUploads(rows: OutboxRow[]) {
        if (this.role === 'viewer') {
            return;
        }
        for (const row of rows) {
            const data = row.data as { asset?: string; logoAsset?: string } | null;
            const hash = row.collection === 'images' ? data?.asset : row.collection === 'teams' ? data?.logoAsset : undefined;
            if (hash && !this.uploaded.has(hash)) {
                this.uploadQueue.add(hash);
            }
        }
        void this.runUploads();
    }

    /** Make sure the server has every picture this device holds for the plan (e.g. after a reload). */
    private queueOwnPictures() {
        const project = useProject.getState().project;
        if (!project || project.id !== this.link.projectId || this.role === 'viewer') {
            return;
        }
        for (const hash of [...project.images.map((image) => image.asset), ...project.teams.map((team) => team.logoAsset)]) {
            if (hash && !this.uploaded.has(hash)) {
                this.uploadQueue.add(hash);
            }
        }
        void this.runUploads();
    }

    /** One upload at a time (a weak uplink is shared), resumable, retried later on failure. */
    private async runUploads() {
        if (this.uploading || this.closed) {
            return;
        }
        this.uploading = true;
        try {
            for (const hash of [...this.uploadQueue]) {
                if (this.closed) {
                    return;
                }
                this.uploadQueue.delete(hash);
                if (this.role === 'viewer') {
                    // Demoted meanwhile: the server would refuse it anyway.
                    this.uploadQueue.clear();
                    this.failedUploads.clear();
                    return;
                }
                const asset = await getAsset(hash).catch(() => undefined);
                // Only real images go to the shared bucket (passive types only); a missing one can't.
                if (!asset || !isRenderableImage(asset)) {
                    continue;
                }
                try {
                    if (!(await this.transport.hasAsset(hash, this.life.signal))) {
                        this.showTransfer(hash, 'up', { done: 0, total: asset.blob.size });
                        await this.transport.uploadAsset(hash, asset.blob, { signal: this.life.signal, onProgress: (p) => this.showTransfer(hash, 'up', p) });
                    }
                    this.uploaded.add(hash);
                    this.failedUploads.delete(hash);
                    this.assetRetry.delete(`up:${hash}`);
                } catch (error) {
                    if (this.closed) {
                        return;
                    }
                    console.warn('live: picture upload failed, retrying later', error);
                    const retry = this.assetRetry.get(`up:${hash}`);
                    const wait = retry ? Math.min(retry.wait * 2, 15 * 60 * 1000) : 15000;
                    this.assetRetry.set(`up:${hash}`, { at: Date.now() + wait, wait });
                    this.failedUploads.add(hash);
                    this.later(() => {
                        if (this.failedUploads.delete(hash)) {
                            this.uploadQueue.add(hash);
                            void this.runUploads();
                        }
                    }, wait);
                } finally {
                    this.showTransfer(hash, 'up', null);
                }
            }
        } finally {
            this.uploading = false;
        }
        if (this.uploadQueue.size > 0) {
            void this.runUploads();
        }
    }

    /** Transfer progress for the UI (at most four updates a second). */
    private showTransfer(hash: string, dir: 'up' | 'down', progress: { done: number; total: number | null } | null) {
        const transfers = { ...useLive.getState().transfers };
        if (!progress) {
            delete transfers[hash];
            useLive.setState({ transfers });
            return;
        }
        const now = Date.now();
        if (now - this.progressAt < 250 && transfers[hash] && progress.done !== progress.total) {
            return;
        }
        this.progressAt = now;
        transfers[hash] = { dir, done: progress.done, total: progress.total };
        useLive.setState({ transfers });
    }

    /** Pictures of the open plan that this device doesn't have. */
    private async missingPictures(): Promise<{ hash: string; mime: string | undefined }[]> {
        const project = useProject.getState().project;
        if (!project || project.id !== this.link.projectId) {
            return [];
        }
        const wanted = [
            ...project.images.map((image) => ({ hash: image.asset, mime: image.mime as string | undefined })),
            ...project.teams.filter((team) => team.logoAsset).map((team) => ({ hash: team.logoAsset!, mime: undefined })),
        ];
        const missing: { hash: string; mime: string | undefined }[] = [];
        for (const item of wanted) {
            if (!missing.some((m) => m.hash === item.hash) && !(await getAsset(item.hash))) {
                missing.push(item);
            }
        }
        return missing;
    }

    /**
     * Fetch image maps and logos this device doesn't have yet — automatically only when the
     * «Bildkarten laden» setting and the connection allow it; otherwise they wait for a tap.
     */
    private async ensureAssets(force = false) {
        const missing = await this.missingPictures();
        if (this.closed) {
            return;
        }
        useLive.setState({ missing: missing.map((m) => m.hash) });
        if (!force && !mayAutoDownload()) {
            return;
        }
        for (const { hash, mime } of missing) {
            if (this.closed) {
                return;
            }
            await this.ensureAsset(hash, mime, force);
        }
    }

    /** Many picture rows in one catch-up: one sweep for all of them, shortly after. */
    private scheduleEnsureAssets() {
        if (!this.ensureTimer) {
            this.ensureTimer = this.later(() => {
                this.ensureTimer = 0;
                void this.ensureAssets();
            }, 500);
        }
    }

    /** The link works again: failed uploads go now instead of after their (long) backoff. */
    private resumeUploads() {
        if (this.failedUploads.size === 0 || this.role === 'viewer') {
            return;
        }
        for (const hash of this.failedUploads) {
            this.assetRetry.delete(`up:${hash}`);
            this.uploadQueue.add(hash);
        }
        this.failedUploads.clear();
        void this.runUploads();
    }

    /** Download pictures now, regardless of the data-saver setting (the user asked for them). */
    loadPictures(hashes?: string[]) {
        if (!hashes) {
            void this.ensureAssets(true);
            return;
        }
        for (const hash of hashes) {
            const project = useProject.getState().project;
            const mime = project?.images.find((image) => image.asset === hash)?.mime;
            void this.ensureAsset(hash, mime, true);
        }
    }

    /**
     * Fetch one picture. Never twice at the same time (polls would otherwise start parallel
     * copies that share — and starve — a weak link), and a failed one waits before the next try.
     */
    private ensureAsset(hash: string | undefined, mime: string | undefined, force = false): Promise<void> {
        if (!hash) {
            return Promise.resolve();
        }
        const running = this.assetJobs.get(hash);
        if (running) {
            return running;
        }
        const retry = this.assetRetry.get(hash);
        if (retry?.at === Number.POSITIVE_INFINITY) {
            // Arrived before but wasn't this picture (or too large): fetching again won't help.
            if (force) {
                toast(t('maps.imageUnusable'), { tone: 'warn' });
            }
            return Promise.resolve();
        }
        if (!force && retry && retry.at > Date.now()) {
            return Promise.resolve();
        }
        const job = (async () => {
            if (await getAsset(hash)) {
                return;
            }
            let blob: Blob | null = null;
            let unreachable = false;
            // Visible from the start: the first piece can take a while on a weak link.
            this.showTransfer(hash, 'down', { done: 0, total: null });
            try {
                blob = await this.transport.downloadAsset(hash, { signal: this.life.signal, onProgress: (p) => this.showTransfer(hash, 'down', p) });
            } catch {
                blob = null;
                unreachable = true;
            } finally {
                this.showTransfer(hash, 'down', null);
            }
            if (this.closed) {
                return;
            }
            const bytes = blob && blob.size <= 40 * 1024 * 1024 ? new Uint8Array(await blob.arrayBuffer()) : null;
            // Content-addressed: anything that doesn't hash to its name is dropped.
            if (bytes && (await sha256Hex(bytes)) === hash) {
                this.assetRetry.delete(hash);
                await putVerifiedAsset(hash, bytes, safeMime(mime ?? blob?.type));
                useLive.setState({ missing: useLive.getState().missing.filter((m) => m !== hash) });
                renderPlan();
                return;
            }
            if (bytes || (blob && blob.size > 40 * 1024 * 1024)) {
                // It arrived but is not this picture (or too large): no point fetching it again this session.
                this.assetRetry.set(hash, { at: Number.POSITIVE_INFINITY, wait: 0 });
                return;
            }
            // Not on the server yet (the partner is still uploading): ask again soon — that is one
            // tiny request. The link broke: back off longer. A tap never makes later tries slower.
            const cap = unreachable ? 5 * 60 * 1000 : 60 * 1000;
            const wait = force || !retry ? 15000 : Math.min(retry.wait * 2, cap);
            this.assetRetry.set(hash, { at: Date.now() + wait, wait });
            if (force && !unreachable) {
                toast(t('maps.imageNotYet'), { tone: 'warn' });
            }
        })().finally(() => this.assetJobs.delete(hash));
        this.assetJobs.set(hash, job);
        return job;
    }

    /** Everything up to `seq` is known (after a complete pull). */
    private advanceTo(seq: number) {
        if (seq > this.lastSeq) {
            this.lastSeq = seq;
        }
        for (const seen of this.seenAbove) {
            if (seen <= this.lastSeq) {
                this.seenAbove.delete(seen);
            }
        }
        while (this.seenAbove.has(this.lastSeq + 1)) {
            this.seenAbove.delete(this.lastSeq + 1);
            this.lastSeq += 1;
        }
        this.saveVersions();
    }

    /** Partner changes held back during a push: apply them now through the normal path. */
    private replayDeferred() {
        if (this.deferred.size === 0) {
            return;
        }
        const held = [...this.deferred.values()];
        this.deferred.clear();
        for (const entity of held) {
            this.onRemote(entity);
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
        if (entity.clientId === this.clientId) {
            // My own write. If its acknowledgement got lost and I edited again since, that edit
            // builds on this write: rebase it so the retry doesn't clash with myself.
            const row = this.pending.get(key);
            if (row && !this.inflight.has(key) && entity.version > row.base) {
                row.base = entity.version;
                row.prev = entity.data;
                this.persist(row);
            }
            this.versions.set(key, entity.version);
            this.saveVersions();
            return;
        }
        if (this.inflight.has(key)) {
            // Hold it until my push returns, then apply or let the version check catch the clash.
            const held = this.deferred.get(key);
            if (!held || held.version < entity.version) {
                this.deferred.set(key, entity);
            }
            return;
        }
        if (this.pending.has(key)) {
            // My waiting edit is based on an older version: its push meets this one as a conflict.
            return;
        }
        if (!this.applyRemote([entity])) {
            // Not applied (invalid for this device, or the plan was just closed): its version is not
            // recorded and the stored seq stays below it, so the next session pulls it again.
            this.holdSeq = Math.min(this.holdSeq, entity.seq - 1);
            return;
        }
        this.versions.set(key, entity.version);
        this.saveVersions();
        if (entity.collection === 'images' || entity.collection === 'teams') {
            // A new or changed picture row: its picture may be ready now — no waiting out an old backoff.
            const data = entity.data as { asset?: string; logoAsset?: string } | null;
            const hash = entity.collection === 'images' ? data?.asset : data?.logoAsset;
            if (hash && this.assetRetry.get(hash)?.at !== Number.POSITIVE_INFINITY) {
                this.assetRetry.delete(hash);
            }
            this.scheduleEnsureAssets();
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
        // Only owners and admins can send on the channel (realtime policy / loopback check).
        if (this.closed || typeof message.from !== 'string' || message.from === this.clientId) {
            return;
        }
        if (message.leading === false) {
            if (useLive.getState().leaderId === message.from) {
                // Stepping back for another admin hands the followers over instead of dropping them.
                const to = typeof message.to === 'string' && message.to !== this.clientId ? message.to : null;
                if (to) {
                    this.setLeader(to, useLive.getState().presence.find((p) => p.clientId === to)?.name ?? null);
                } else {
                    this.setLeader(null, null);
                }
            }
            return;
        }
        if (this.leading) {
            // Two admins started at once: the smaller client id keeps leading, the other yields.
            if (message.from > this.clientId) {
                return;
            }
            this.yieldTo = message.from;
            setLeading(false);
            this.yieldTo = null;
        }
        this.setLeader(message.from, typeof message.name === 'string' ? message.name.slice(0, 40) : null);
        const live = useLive.getState();
        if (!live.following || message.from !== live.leaderId || !Number.isInteger(message.phaseIndex) || message.phaseIndex < 0) {
            return;
        }
        const signature = JSON.stringify([message.phaseIndex, message.camera]);
        if (signature === this.lastApplied) {
            return;
        }
        this.lastApplied = signature;
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
        this.life.abort();
        window.clearInterval(this.heartbeat);
        stopCameraShare?.();
        stopCameraShare = null;
        this.stop.forEach((fn) => fn());
        this.stop = [];
        this.timers.forEach((id) => window.clearTimeout(id));
        this.timers.clear();
        window.clearTimeout(this.versionTimer);
        await this.persistChain;
        await this.writeVersions();
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
export async function joinLive(code: string, kind: 'supabase' | 'loopback', onProgress?: (count: number) => void): Promise<{ project: Project; info: JoinInfo; alreadyMember: boolean }> {
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
            return { project: stored.data, info, alreadyMember: true };
        }
    }
    const transport = backend.open(info.planId);
    let entities: RemoteEntity[];
    try {
        entities = await pullAll(transport, onProgress);
    } finally {
        transport.close();
    }
    const project = projectFromEntities(entities, info);
    await saveProject(project);
    // The versions this copy is based on, so the first edit isn't mistaken for a clash.
    await kvSet(versionsKey(project.id), Object.fromEntries(entities.map((e) => [keyOf(e.collection, e.entityId), e.version])));
    await db.liveLinks.put({ projectId: project.id, remoteId: info.planId, role: info.role, backend: kind, lastSeq: entities.reduce((max, e) => Math.max(max, e.seq), 0), name: info.name, userId });
    return { project, info, alreadyMember: false };
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
export function isLeading(): boolean {
    return session?.leading ?? false;
}

export function setLeading(on: boolean) {
    if (!session || session.role === 'viewer' || (!on && !session.leading && useLive.getState().leaderId !== session.clientId)) {
        return;
    }
    session.setLeading(on);
    useLive.setState({ leaderId: on ? session.clientId : null, leaderName: on ? displayName() : null, following: false });
    stopCameraShare?.();
    stopCameraShare = null;
    const map = mapRef.current;
    if (on && map) {
        let timer = 0;
        const share = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => broadcastNow(), 250);
        };
        map.on('moveend', share);
        stopCameraShare = () => {
            window.clearTimeout(timer);
            map.off('moveend', share);
        };
        broadcastNow();
    }
}

export function setFollowing(on: boolean) {
    useLive.setState({ following: on });
}

/** Load pictures held back by the data saver (all missing ones, or the given ones). */
export function loadPictures(hashes?: string[]) {
    session?.loadPictures(hashes);
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
