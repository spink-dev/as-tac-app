import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { ChatMessage, LiveRole, Presence } from './state';
import type { BriefingMessage, JoinInfo, LiveBackend, LiveTransport, PushOp, PushResult, RemoteCollection, RemoteEntity, TransportHandlers } from './types';

/**
 * Supabase backend. Only the public URL and the publishable key reach the browser (build-time
 * env); every write is an RPC that checks the caller's role (supabase/migrations/*_live.sql).
 * The client library is loaded on demand, so plans without live mode never download it.
 */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export function supabaseConfigured(): boolean {
    return Boolean(URL_ && KEY && !/service_role|sb_secret/i.test(KEY));
}

let client: Promise<SupabaseClient> | null = null;

export function supabaseClient(): Promise<SupabaseClient> {
    if (!supabaseConfigured()) {
        return Promise.reject(new Error('not-configured'));
    }
    client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(URL_!, KEY!, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    }));
    return client;
}

/** Signed-in user id, or `null`. */
export async function currentUser(): Promise<{ id: string; email: string | null; anonymous: boolean } | null> {
    if (!supabaseConfigured()) {
        return null;
    }
    const sb = await supabaseClient();
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    return user ? { id: user.id, email: user.email ?? null, anonymous: Boolean(user.is_anonymous) } : null;
}

/**
 * The account stored on this device, read without any network call (an expired token offline
 * would otherwise keep auth retrying for many seconds). Used to decide whose copy a plan is —
 * not to authorise anything; the server checks the real session.
 */
export async function storedUserId(): Promise<string | null> {
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && /^sb-.*-auth-token$/.test(key)) {
                const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as { user?: { id?: unknown } } | null;
                if (typeof stored?.user?.id === 'string') {
                    return stored.user.id;
                }
            }
        }
    } catch {
        // Storage unavailable: ask the client below.
    }
    return (await currentUser().catch(() => null))?.id ?? null;
}

/** Quick start: an anonymous account bound to this device (can be upgraded with an email later). */
export async function signInDevice(): Promise<void> {
    const sb = await supabaseClient();
    const { error } = await sb.auth.signInAnonymously();
    if (error) {
        throw error;
    }
}

export async function sendMagicLink(email: string): Promise<void> {
    const sb = await supabaseClient();
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${import.meta.env.BASE_URL}` } });
    if (error) {
        throw error;
    }
}

export async function signOut(): Promise<void> {
    const sb = await supabaseClient();
    await sb.auth.signOut();
}

function rpcError(error: { message?: string; code?: string } | null): Error {
    const message = error?.message ?? 'error';
    for (const known of ['forbidden', 'unauthenticated', 'invite']) {
        if (message.includes(known)) {
            return new Error(known);
        }
    }
    // Keep the SQLSTATE so the engine can tell a permanent rejection from network trouble.
    return new Error(error?.code ? `${error.code} ${message}` : message);
}

function toEntity(row: Record<string, unknown>): RemoteEntity | null {
    // A row without a data field (partial realtime payload) is not a deletion: ignore it.
    if (!('data' in row) || typeof row.collection !== 'string') {
        return null;
    }
    return {
        collection: row.collection as RemoteCollection,
        entityId: String(row.entity_id),
        data: row.data ?? null,
        version: Number(row.version),
        seq: Number(row.seq),
        clientId: typeof row.client_id === 'string' ? row.client_id : null,
    };
}

export class SupabaseBackend implements LiveBackend {
    readonly kind = 'supabase' as const;

    async userId(): Promise<string | null> {
        return storedUserId();
    }

    async createPlan(name: string, areaId: string | null, displayName: string): Promise<string> {
        const sb = await supabaseClient();
        const { data, error } = await sb.rpc('live_create_plan', { p_name: name, p_area: areaId, p_display: displayName });
        if (error) {
            throw rpcError(error);
        }
        return String(data);
    }

    async redeem(code: string, displayName: string): Promise<JoinInfo> {
        const sb = await supabaseClient();
        const { data, error } = await sb.rpc('live_redeem_invite', { p_code: code, p_display: displayName });
        if (error) {
            throw rpcError(error);
        }
        const info = data as { planId: string; name: string; areaId: string | null; role: LiveRole };
        return { planId: info.planId, name: info.name, areaId: info.areaId, role: info.role };
    }

    open(planId: string): LiveTransport {
        return new SupabaseTransport(planId);
    }
}

class SupabaseTransport implements LiveTransport {
    readonly kind = 'supabase' as const;
    private channel: RealtimeChannel | null = null;
    private closed = false;
    /** Roles by account, from the membership table (presence claims are not trusted). */
    private roles = new Map<string, LiveRole>();
    private rolesAt = 0;

    constructor(readonly planId: string) {}

    async pull(since: number): Promise<RemoteEntity[]> {
        const sb = await supabaseClient();
        const out: RemoteEntity[] = [];
        // PostgREST caps rows per request: page by sequence.
        let cursor = since;
        while (true) {
            const { data, error } = await sb.from('live_entities').select('collection, entity_id, data, version, seq, client_id')
                .eq('plan_id', this.planId).gt('seq', cursor).order('seq', { ascending: true }).limit(1000);
            if (error) {
                throw rpcError(error);
            }
            const rows = (data ?? []).map((row) => toEntity(row as Record<string, unknown>)).filter((row): row is RemoteEntity => row !== null);
            out.push(...rows);
            if ((data ?? []).length < 1000) {
                return out;
            }
            cursor = Number((data ?? [])[(data ?? []).length - 1].seq);
        }
    }

    async push(ops: PushOp[], clientId: string): Promise<PushResult> {
        const sb = await supabaseClient();
        const { data, error } = await sb.rpc('live_push', { p_plan: this.planId, p_ops: ops, p_client: clientId });
        if (error) {
            throw rpcError(error);
        }
        return data as PushResult;
    }

    private async loadRoles() {
        const sb = await supabaseClient();
        const { data } = await sb.from('live_members').select('user_id, role').eq('plan_id', this.planId);
        this.roles = new Map((data ?? []).map((row) => [String(row.user_id), row.role as LiveRole]));
        this.rolesAt = Date.now();
    }

    async subscribe(handlers: TransportHandlers): Promise<void> {
        const sb = await supabaseClient();
        const me = await storedUserId();
        await this.loadRoles();
        await sb.realtime.setAuth();
        const topic = `plan:${this.planId}`;
        // A channel left over from an earlier session would swallow this subscribe: remove it first.
        for (const stale of sb.getChannels().filter((channel) => channel.topic === `realtime:${topic}`)) {
            await sb.removeChannel(stale);
        }
        if (this.closed) {
            return;
        }
        const channel = sb.channel(topic, { config: { private: true, broadcast: { self: false }, presence: { key: me ?? undefined } } });
        const emitPresence = () => {
            const state = channel.presenceState<Presence>();
            const people: Presence[] = [];
            for (const [userId, entries] of Object.entries(state)) {
                const role = this.roles.get(userId);
                if (!role) {
                    continue;
                }
                for (const p of entries) {
                    people.push({ clientId: String(p.clientId), name: String(p.name ?? '').slice(0, 40), role, userId, color: String(p.color ?? '#888888') });
                }
            }
            handlers.presence(people);
        };
        channel
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_entities', filter: `plan_id=eq.${this.planId}` }, (payload) => {
                const entity = toEntity((payload.new ?? {}) as Record<string, unknown>);
                if (entity) {
                    handlers.entity(entity);
                }
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat', filter: `plan_id=eq.${this.planId}` }, (payload) => {
                const row = payload.new as Record<string, unknown>;
                handlers.chat({ id: String(row.id), author: String(row.user_id), authorName: String(row.display_name ?? ''), body: String(row.body ?? ''), createdAt: String(row.created_at) });
            })
            .on('presence', { event: 'sync' }, () => {
                // Reload roles for newcomers, and now and then so a changed role shows up.
                const unknown = Object.keys(channel.presenceState()).some((userId) => !this.roles.has(userId));
                if (unknown || Date.now() - this.rolesAt > 30000) {
                    void this.loadRoles().then(emitPresence);
                } else {
                    emitPresence();
                }
            })
            .on('broadcast', { event: 'briefing' }, ({ payload }) => handlers.briefing(payload as BriefingMessage));
        this.channel = channel;
        await new Promise<void>((resolve, reject) => {
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    handlers.status(true);
                    resolve();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    handlers.status(false);
                    reject(new Error(status));
                }
            });
        });
        if (this.closed) {
            this.close();
        }
    }

    track(me: Presence): void {
        void this.channel?.track(me);
    }

    broadcast(message: BriefingMessage): void {
        void this.channel?.send({ type: 'broadcast', event: 'briefing', payload: message });
    }

    async createInvite(role: 'admin' | 'viewer'): Promise<string> {
        const sb = await supabaseClient();
        const { data, error } = await sb.rpc('live_create_invite', { p_plan: this.planId, p_role: role });
        if (error) {
            throw rpcError(error);
        }
        return String(data);
    }

    async chatHistory(): Promise<ChatMessage[]> {
        const sb = await supabaseClient();
        const { data } = await sb.from('live_chat').select('id, user_id, display_name, body, created_at').eq('plan_id', this.planId).order('id', { ascending: false }).limit(100);
        return (data ?? []).reverse().map((row) => ({ id: String(row.id), author: String(row.user_id), authorName: String(row.display_name ?? ''), body: String(row.body), createdAt: String(row.created_at) }));
    }

    async sendChat(body: string): Promise<void> {
        const sb = await supabaseClient();
        const { error } = await sb.rpc('live_chat_send', { p_plan: this.planId, p_body: body });
        if (error) {
            throw rpcError(error);
        }
    }

    async uploadAsset(hash: string, blob: Blob): Promise<void> {
        const sb = await supabaseClient();
        const { error } = await sb.storage.from('live-assets').upload(`${this.planId}/${hash}`, blob, { contentType: blob.type, upsert: false });
        if (error && !/exist|duplicate/i.test(error.message)) {
            throw error;
        }
    }

    async downloadAsset(hash: string): Promise<Blob | null> {
        const sb = await supabaseClient();
        const { data, error } = await sb.storage.from('live-assets').download(`${this.planId}/${hash}`);
        return error ? null : data;
    }

    close(): void {
        this.closed = true;
        const channel = this.channel;
        this.channel = null;
        if (channel) {
            void channel.untrack().catch(() => undefined);
            void supabaseClient().then((sb) => sb.removeChannel(channel)).catch(() => undefined);
        }
    }
}
