import type { ChatMessage, LiveRole, Presence } from './state';
import type { BriefingMessage, JoinInfo, LiveBackend, LiveTransport, PullOptions, PushOp, PushResult, RemoteEntity, TransferOptions, TransportHandlers } from './types';
import { getAsset } from '../storage/assets';

/**
 * Local test mode: the live protocol between tabs of this browser, no server. A tiny "server"
 * lives in localStorage (serialised with Web Locks) and changes fan out over BroadcastChannel.
 * Each tab is its own user, so roles (admin/viewer) can be tried side by side. Same rules as
 * the real backend: version checks, viewers can't write, chat for admins only.
 */

interface PlanState {
    name: string;
    areaId: string | null;
    seq: number;
    members: Record<string, { role: LiveRole; name: string }>;
    entities: Record<string, RemoteEntity>;
    chat: ChatMessage[];
}

const PREFIX = 'as-tac-loopback';
const INVITES = `${PREFIX}:invites`;
/* Same limits as the SQL functions (supabase/migrations). */
const MAX_OPS = 500;
const MAX_ENTITY_BYTES = 1024 * 1024;
const MAX_ENTITIES = 60000;
const ENTITY_ID = /^.{1,80}$/s;

type InviteRow = { planId: string; role: 'admin' | 'viewer'; expires: number; createdBy?: string };

export interface KeyValue {
    get(key: string): string | null;
    set(key: string, value: string): void;
}

const browserStore: KeyValue = {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
};

/** Per-tab identity (sessionStorage), so two tabs are two people. */
export function loopbackUserId(): string {
    try {
        let id = sessionStorage.getItem(`${PREFIX}:user`);
        if (!id) {
            id = crypto.randomUUID();
            sessionStorage.setItem(`${PREFIX}:user`, id);
        }
        return id;
    } catch {
        return 'tab';
    }
}

/**
 * Test hook: `window.__asTacNet = { latencyMs, kbps, failRate }` makes the test mode behave like
 * a weak mobile link — every request waits for latency plus its size at that speed, and a share
 * of them fail (before the server sees them, or after it applied them with the reply lost).
 * Realtime messages are dropped at the same rate. Off unless a test sets it.
 */
interface NetSim {
    latencyMs?: number;
    kbps?: number;
    failRate?: number;
}

function netSim(): NetSim | null {
    return typeof window !== 'undefined' ? (window as Window & { __asTacNet?: NetSim }).__asTacNet ?? null : null;
}

/** Bytes and requests that crossed the simulated link (for tests to report). */
function count(bytes: number, direction: 'up' | 'down') {
    const stats = ((window as Window & { __asTacNetStats?: { up: number; down: number; requests: number } }).__asTacNetStats ??= { up: 0, down: 0, requests: 0 });
    stats[direction] += bytes;
    if (direction === 'up') {
        stats.requests += 1;
    }
}

async function travel(bytes: number, signal?: AbortSignal, direction: 'up' | 'down' = 'up'): Promise<void> {
    const sim = netSim();
    if (!sim) {
        return;
    }
    count(bytes, direction);
    const ms = (sim.latencyMs ?? 0) + (sim.kbps ? (bytes * 8) / sim.kbps : 0);
    await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            window.clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
    });
}

const unlucky = () => Math.random() < (netSim()?.failRate ?? 0);

async function locked<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    return locks ? locks.request(`${PREFIX}:${name}`, async () => fn()) : fn();
}

function code(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, (b) => alphabet[b % 32]).join('');
}

export class LoopbackBackend implements LiveBackend {
    readonly kind = 'loopback' as const;
    constructor(private store: KeyValue = browserStore, private user = loopbackUserId()) {}

    private read(planId: string): PlanState | null {
        const raw = this.store.get(`${PREFIX}:plan:${planId}`);
        return raw ? JSON.parse(raw) as PlanState : null;
    }

    private write(planId: string, state: PlanState) {
        this.store.set(`${PREFIX}:plan:${planId}`, JSON.stringify(state));
    }

    async userId(): Promise<string | null> {
        return this.user;
    }

    async createPlan(name: string, areaId: string | null, displayName: string): Promise<string> {
        const id = crypto.randomUUID();
        this.write(id, { name, areaId, seq: 0, members: { [this.user]: { role: 'owner', name: displayName } }, entities: {}, chat: [] });
        return id;
    }

    async redeem(input: string, displayName: string): Promise<JoinInfo> {
        const invites = JSON.parse(this.store.get(INVITES) ?? '{}') as Record<string, InviteRow>;
        const invite = invites[input.trim().toUpperCase()];
        if (!invite || invite.expires < Date.now()) {
            throw new Error('invite');
        }
        return locked(invite.planId, () => {
            const state = this.read(invite.planId);
            // The invite is only as good as its creator's current role (owner, or admin for viewers).
            const creator = invite.createdBy ? state?.members[invite.createdBy]?.role : undefined;
            if (!state || !creator || !(creator === 'owner' || (invite.role === 'viewer' && creator === 'admin'))) {
                throw new Error('invite');
            }
            // Codes only add new members; an existing member keeps their role (owner decides roles).
            const role: LiveRole = state.members[this.user]?.role ?? invite.role;
            state.members[this.user] = { role, name: displayName };
            this.write(invite.planId, state);
            return { planId: invite.planId, name: state.name, areaId: state.areaId, role };
        });
    }

    open(planId: string): LiveTransport {
        return new LoopbackTransport(this, planId, this.user);
    }

    /* Server-side operations, used by the transport. */

    role(planId: string, user: string): LiveRole | null {
        return this.read(planId)?.members[user]?.role ?? null;
    }

    entities(planId: string, since: number): RemoteEntity[] {
        const state = this.read(planId);
        return state ? Object.values(state.entities).filter((e) => e.seq > since).sort((a, b) => a.seq - b.seq) : [];
    }

    apply(planId: string, user: string, ops: PushOp[], clientId: string): Promise<{ result: PushResult; changed: RemoteEntity[] }> {
        return locked(planId, () => {
            const state = this.read(planId);
            const role = state?.members[user]?.role;
            if (!state || (role !== 'owner' && role !== 'admin')) {
                throw new Error('forbidden');
            }
            if (!Array.isArray(ops) || ops.length > MAX_OPS) {
                throw new Error('batch');
            }
            // Validate the whole batch first: the server rolls back on any bad change.
            for (const op of ops) {
                const data = op.data as { id?: unknown } | null;
                if (typeof op.entityId !== 'string' || !ENTITY_ID.test(op.entityId)) {
                    throw new Error('22023 invalid entity id');
                }
                if (data !== null && (typeof data !== 'object' || new TextEncoder().encode(JSON.stringify(data)).length > MAX_ENTITY_BYTES)) {
                    throw new Error('23514 violates check constraint');
                }
                if (op.collection !== 'meta' && op.collection !== 'order' && data && !Array.isArray(data) && data.id !== op.entityId) {
                    throw new Error('22023 entity id mismatch');
                }
            }
            const result: PushResult = { applied: [], conflicts: [] };
            const changed: RemoteEntity[] = [];
            for (const op of ops) {
                const key = `${op.collection}:${op.entityId}`;
                const current = state.entities[key];
                if ((current?.version ?? 0) !== op.base) {
                    result.conflicts.push({ collection: op.collection, entityId: op.entityId, version: current?.version ?? 0, data: current?.data ?? null });
                    continue;
                }
                state.seq += 1;
                const entity: RemoteEntity = { collection: op.collection, entityId: op.entityId, data: op.data, version: (current?.version ?? 0) + 1, seq: state.seq, clientId };
                state.entities[key] = entity;
                if (op.collection === 'meta' && op.data && typeof op.data === 'object') {
                    const meta = op.data as { name?: string; areaId?: string | null };
                    state.name = meta.name || state.name;
                    state.areaId = meta.areaId ?? null;
                }
                changed.push(entity);
                result.applied.push({ collection: op.collection, entityId: op.entityId, version: entity.version, seq: entity.seq });
            }
            if (Object.keys(state.entities).length > MAX_ENTITIES) {
                throw new Error('limit');
            }
            this.write(planId, state);
            return { result, changed };
        });
    }

    invite(planId: string, user: string, role: 'admin' | 'viewer'): string {
        const r = this.role(planId, user);
        // Admin invites are owner-only; admins may invite viewers.
        if (r !== 'owner' && !(r === 'admin' && role === 'viewer')) {
            throw new Error('forbidden');
        }
        const invites = JSON.parse(this.store.get(INVITES) ?? '{}') as Record<string, InviteRow>;
        const c = code();
        invites[c] = { planId, role, expires: Date.now() + 24 * 3600 * 1000, createdBy: user };
        this.store.set(INVITES, JSON.stringify(invites));
        return c;
    }

    chat(planId: string, user: string): ChatMessage[] {
        const r = this.role(planId, user);
        return r === 'owner' || r === 'admin' ? this.read(planId)?.chat ?? [] : [];
    }

    addChat(planId: string, user: string, body: string): Promise<ChatMessage> {
        return locked(planId, () => {
            const state = this.read(planId);
            const member = state?.members[user];
            if (!state || !member || member.role === 'viewer') {
                throw new Error('forbidden');
            }
            const message: ChatMessage = { id: crypto.randomUUID(), author: user, authorName: member.name, body: body.slice(0, 1000), createdAt: new Date().toISOString() };
            state.chat = [...state.chat.slice(-199), message];
            this.write(planId, state);
            return message;
        });
    }
}

type Wire =
    | { type: 'entity'; entity: RemoteEntity }
    | { type: 'presence'; person: Presence; user: string }
    | { type: 'leave'; clientId: string }
    | { type: 'hello' }
    | { type: 'briefing'; message: BriefingMessage; user: string }
    | { type: 'chat'; message: ChatMessage };

class LoopbackTransport implements LiveTransport {
    readonly kind = 'loopback' as const;
    private channel: BroadcastChannel;
    private handlers: TransportHandlers | null = null;
    private people = new Map<string, { person: Presence; seen: number }>();
    private me: Presence | null = null;
    private timer = 0;
    /** Leaving the page (reload, close) says goodbye right away instead of after the timeout. */
    private readonly onPageHide = () => {
        if (this.me) {
            this.post({ type: 'leave', clientId: this.me.clientId });
        }
    };

    constructor(private server: LoopbackBackend, readonly planId: string, private user: string) {
        this.channel = new BroadcastChannel(`${PREFIX}:${planId}`);
    }

    async pull(since: number, options: PullOptions): Promise<RemoteEntity[]> {
        await travel(200, options.signal);
        if (unlucky()) {
            throw new TypeError('Failed to fetch');
        }
        if (!this.server.role(this.planId, this.user)) {
            throw new Error('forbidden');
        }
        const page = this.server.entities(this.planId, since)
            .filter((entity) => !options.exclude || entity.clientId !== options.exclude)
            .slice(0, options.limit);
        await travel(JSON.stringify(page).length, options.signal, 'down');
        return page;
    }

    async push(ops: PushOp[], clientId: string, signal?: AbortSignal): Promise<PushResult> {
        await travel(JSON.stringify(ops).length, signal);
        if (unlucky()) {
            throw new TypeError('Failed to fetch');
        }
        const { result, changed } = await this.server.apply(this.planId, this.user, ops, clientId);
        for (const entity of changed) {
            this.post({ type: 'entity', entity });
        }
        if (unlucky()) {
            // Applied on the server, but the reply never arrives.
            throw new TypeError('Failed to fetch');
        }
        await travel(JSON.stringify(result).length, signal, 'down');
        return result;
    }

    async subscribe(handlers: TransportHandlers): Promise<void> {
        this.handlers = handlers;
        this.channel.onmessage = (event: MessageEvent<Wire>) => this.receive(event.data);
        // Presence heartbeat; people not heard from for 15 s are gone.
        this.timer = window.setInterval(() => {
            if (this.me) {
                this.post({ type: 'presence', person: this.me, user: this.user });
            }
            this.prune();
        }, 5000);
        this.post({ type: 'hello' });
        window.addEventListener('pagehide', this.onPageHide);
        handlers.status(true);
    }

    private post(message: Wire) {
        this.channel.postMessage(message);
    }

    private emitPresence() {
        const list = [...this.people.values()].map((entry) => entry.person);
        if (this.me) {
            list.unshift(this.me);
        }
        this.handlers?.presence(list);
    }

    private prune() {
        const now = Date.now();
        let changed = false;
        for (const [id, entry] of this.people) {
            if (now - entry.seen > 15000) {
                this.people.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this.emitPresence();
        }
    }

    private receive(message: Wire) {
        const role = this.server.role(this.planId, this.user);
        if (!role || !this.handlers) {
            return;
        }
        switch (message.type) {
            case 'entity':
                // A weak link loses realtime messages too; catch-up has to fill the gap.
                if (!unlucky()) {
                    this.handlers.entity(message.entity);
                }
                break;
            case 'presence': {
                // Roles come from the membership list, never from what a peer claims.
                const senderRole = this.server.role(this.planId, message.user);
                if (!senderRole) {
                    break;
                }
                const person: Presence = { clientId: String(message.person.clientId), name: String(message.person.name ?? '').slice(0, 40), color: String(message.person.color ?? '#888888'), role: senderRole, userId: message.user };
                this.people.set(person.clientId, { person, seen: Date.now() });
                this.emitPresence();
                break;
            }
            case 'leave':
                this.people.delete(message.clientId);
                this.emitPresence();
                break;
            case 'hello':
                if (this.me) {
                    this.post({ type: 'presence', person: this.me, user: this.user });
                }
                break;
            case 'briefing': {
                // Only admins may lead a presentation (mirrors the realtime channel policy).
                const senderRole = this.server.role(this.planId, message.user);
                if (senderRole === 'owner' || senderRole === 'admin') {
                    this.handlers.briefing(message.message);
                }
                break;
            }
            case 'chat':
                if (role !== 'viewer') {
                    this.handlers.chat(message.message);
                }
                break;
        }
    }

    track(me: Presence): void {
        this.me = me;
        this.post({ type: 'presence', person: me, user: this.user });
        this.emitPresence();
    }

    broadcast(message: BriefingMessage): void {
        this.post({ type: 'briefing', message, user: this.user });
    }

    async createInvite(role: 'admin' | 'viewer'): Promise<string> {
        return this.server.invite(this.planId, this.user, role);
    }

    async chatHistory(): Promise<ChatMessage[]> {
        return this.server.chat(this.planId, this.user);
    }

    async sendChat(body: string): Promise<void> {
        const message = await this.server.addChat(this.planId, this.user, body);
        this.post({ type: 'chat', message });
        this.handlers?.chat(message);
    }

    /*
     * Test mode keeps a "server copy" of pictures in Cache Storage, so transfers cross the
     * simulated link like on a real server (and a test can remove a device's own copy).
     */
    private async assetCache(): Promise<Cache | null> {
        return typeof caches === 'undefined' ? null : caches.open(`${PREFIX}:assets`).catch(() => null);
    }

    private assetUrl(hash: string): string {
        return `https://loopback.invalid/${this.planId}/${hash}`;
    }

    async uploadAsset(hash: string, blob: Blob, options: TransferOptions = {}): Promise<void> {
        const cache = await this.assetCache();
        if (!cache || await cache.match(this.assetUrl(hash))) {
            options.onProgress?.({ done: blob.size, total: blob.size });
            return;
        }
        await this.travelPieces(blob.size, 'up', options);
        await cache.put(this.assetUrl(hash), new Response(blob, { headers: { 'content-type': blob.type } }));
    }

    async downloadAsset(hash: string, options: TransferOptions = {}): Promise<Blob | null> {
        const cache = await this.assetCache();
        const response = cache ? await cache.match(this.assetUrl(hash)) : undefined;
        if (!response) {
            // Older test plans: the picture only exists in this browser's own store.
            return (await getAsset(hash))?.blob ?? null;
        }
        const blob = await response.blob();
        await this.travelPieces(blob.size, 'down', options);
        return blob;
    }

    /** Move `size` bytes over the simulated link in 512 KB pieces (each may fail and is retried). */
    private async travelPieces(size: number, direction: 'up' | 'down', options: TransferOptions) {
        const piece = 512 * 1024;
        let done = 0;
        let failures = 0;
        while (done < size) {
            const length = Math.min(piece, size - done);
            try {
                await travel(length, options.signal, direction);
                if (unlucky()) {
                    throw new TypeError('Failed to fetch');
                }
                done += length;
                failures = 0;
                options.onProgress?.({ done, total: size });
            } catch (error) {
                failures += 1;
                if (options.signal?.aborted || failures >= 5) {
                    throw error;
                }
            }
        }
    }

    close(): void {
        if (this.me) {
            this.post({ type: 'leave', clientId: this.me.clientId });
        }
        window.clearInterval(this.timer);
        window.removeEventListener('pagehide', this.onPageHide);
        this.channel.close();
        this.handlers = null;
    }
}
