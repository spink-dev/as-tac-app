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

function rpcError(error: { message?: string } | null): Error {
    const message = error?.message ?? 'error';
    for (const known of ['forbidden', 'unauthenticated', 'invite', 'limit', 'batch', 'role']) {
        if (message.includes(known)) {
            return new Error(known);
        }
    }
    return new Error(message);
}

function toEntity(row: Record<string, unknown>): RemoteEntity {
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
        return (await currentUser())?.id ?? null;
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
            const rows = (data ?? []).map((row) => toEntity(row as Record<string, unknown>));
            out.push(...rows);
            if (rows.length < 1000) {
                return out;
            }
            cursor = rows[rows.length - 1].seq;
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

    async subscribe(handlers: TransportHandlers): Promise<void> {
        const sb = await supabaseClient();
        await sb.realtime.setAuth();
        const channel = sb.channel(`plan:${this.planId}`, { config: { private: true, broadcast: { self: false } } });
        channel
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_entities', filter: `plan_id=eq.${this.planId}` }, (payload) => {
                const row = payload.new as Record<string, unknown> | undefined;
                if (row && row.collection) {
                    handlers.entity(toEntity(row));
                }
            })
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_chat', filter: `plan_id=eq.${this.planId}` }, (payload) => {
                const row = payload.new as Record<string, unknown>;
                handlers.chat({ id: String(row.id), author: String(row.user_id), authorName: String(row.display_name ?? ''), body: String(row.body ?? ''), createdAt: String(row.created_at) });
            })
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState<Presence>();
                handlers.presence(Object.values(state).flat().map((p) => ({ clientId: p.clientId, name: p.name, role: p.role, color: p.color, leading: p.leading })));
            })
            .on('broadcast', { event: 'briefing' }, ({ payload }) => handlers.briefing(payload as BriefingMessage));
        await new Promise<void>((resolve) => {
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    handlers.status(true);
                    resolve();
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    handlers.status(false);
                    resolve();
                }
            });
        });
        this.channel = channel;
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
        if (this.channel) {
            void this.channel.untrack();
            void supabaseClient().then((sb) => sb.removeChannel(this.channel!));
        }
        this.channel = null;
    }
}
