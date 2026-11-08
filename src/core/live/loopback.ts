import type { ChatMessage, LiveRole, Presence } from './state';
import type { BriefingMessage, JoinInfo, LiveBackend, LiveTransport, PushOp, PushResult, RemoteEntity, TransportHandlers } from './types';
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
            const current = state.members[this.user]?.role;
            const role: LiveRole = !current ? invite.role : current === 'viewer' && invite.role === 'admin' ? 'admin' : current;
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

    constructor(private server: LoopbackBackend, readonly planId: string, private user: string) {
        this.channel = new BroadcastChannel(`${PREFIX}:${planId}`);
    }

    async pull(since: number): Promise<RemoteEntity[]> {
        if (!this.server.role(this.planId, this.user)) {
            throw new Error('forbidden');
        }
        return this.server.entities(this.planId, since);
    }

    async push(ops: PushOp[], clientId: string): Promise<PushResult> {
        const { result, changed } = await this.server.apply(this.planId, this.user, ops, clientId);
        for (const entity of changed) {
            this.post({ type: 'entity', entity });
        }
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
                this.handlers.entity(message.entity);
                break;
            case 'presence': {
                // Roles come from the membership list, never from what a peer claims.
                const senderRole = this.server.role(this.planId, message.user);
                if (!senderRole) {
                    break;
                }
                const person: Presence = { ...message.person, role: senderRole, userId: message.user, leading: Boolean(message.person.leading) && senderRole !== 'viewer' };
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

    async uploadAsset(): Promise<void> {
        // Tabs share this origin's IndexedDB: nothing to transfer.
    }

    async downloadAsset(hash: string): Promise<Blob | null> {
        return (await getAsset(hash))?.blob ?? null;
    }

    close(): void {
        if (this.me) {
            this.post({ type: 'leave', clientId: this.me.clientId });
        }
        window.clearInterval(this.timer);
        this.channel.close();
        this.handlers = null;
    }
}
