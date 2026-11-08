import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { ChatMessage, LiveRole, Presence } from './state';
import type { BriefingMessage, JoinInfo, LiveBackend, LiveTransport, PullOptions, PushOp, PushResult, RemoteCollection, RemoteEntity, TransferOptions, TransportHandlers } from './types';
import { rangeDownload, TUS_PIECE, tusUpload } from './transfer';

/**
 * Supabase backend. Only the public URL and the publishable key reach the browser (build-time
 * env); every write is an RPC that checks the caller's role (supabase/migrations/*_live.sql).
 * The client library is loaded on demand, so plans without live mode never download it.
 */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** A legacy JWT key names its role inside the token: never use a service_role key in a browser. */
function secretKey(key: string): boolean {
    if (/service_role|sb_secret/i.test(key)) {
        return true;
    }
    const parts = key.split('.');
    if (parts.length === 3) {
        try {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
            return payload.role === 'service_role';
        } catch {
            return false;
        }
    }
    return false;
}

export function supabaseConfigured(): boolean {
    return Boolean(URL_ && KEY && !secretKey(KEY));
}

/** Storage says "no such object" (as opposed to: could not ask). */
function missingObject(error: { message?: string; statusCode?: string | number } | null): boolean {
    // Storage also reports invalid tokens with statusCode 400: only the wording or a 404 means "missing".
    return Boolean(error && (/not.?found|does not exist/i.test(error.message ?? '') || ['404', 404].includes(error.statusCode ?? '')));
}

let client: Promise<SupabaseClient> | null = null;

/** Wait for the first byte of an answer; long enough for a slow upload of the request itself. */
const FIRST_BYTE_MS = 60000;
/** Then: no byte for this long means the connection is dead (mobile links stall silently). */
const STALL_MS = 30000;

function bodySize(body: BodyInit | null | undefined): number | null {
    if (body == null) {
        return 0;
    }
    if (typeof body === 'string') {
        return body.length;
    }
    if (body instanceof Blob) {
        return body.size;
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        return body.byteLength;
    }
    // FormData and streams: unknown size.
    return null;
}

/**
 * `fetch` for the Supabase client on weak links: a request is cut only when it stops receiving
 * data, never because it is merely slow, so large answers still arrive over EDGE.
 */
export function stallFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const outer = init.signal;
    if (outer?.aborted) {
        controller.abort(outer.reason);
    }
    outer?.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
    const size = bodySize(init.body);
    // Sending the request body itself takes time on a slow uplink (about 1 KB/s assumed).
    const firstByte = size === null ? 10 * 60 * 1000 : FIRST_BYTE_MS + size;
    let timer = setTimeout(() => controller.abort(new DOMException('stalled', 'TimeoutError')), firstByte);
    return fetch(input, { ...init, signal: controller.signal }).then((response) => {
        clearTimeout(timer);
        if (!response.body) {
            return response;
        }
        const reader = response.body.getReader();
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(() => controller.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
        };
        arm();
        const body = new ReadableStream<Uint8Array>({
            async pull(sink) {
                try {
                    const { value, done } = await reader.read();
                    if (done) {
                        clearTimeout(timer);
                        sink.close();
                        return;
                    }
                    arm();
                    sink.enqueue(value);
                } catch (error) {
                    clearTimeout(timer);
                    sink.error(error);
                }
            },
            cancel(reason) {
                clearTimeout(timer);
                return reader.cancel(reason);
            },
        });
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }, (error: unknown) => {
        clearTimeout(timer);
        throw error;
    });
}

export function supabaseClient(): Promise<SupabaseClient> {
    if (!supabaseConfigured()) {
        return Promise.reject(new Error('not-configured'));
    }
    client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(URL_!, KEY!, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: stallFetch },
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

    async pull(since: number, options: PullOptions): Promise<RemoteEntity[]> {
        const sb = await supabaseClient();
        let query = sb.from('live_entities').select('collection, entity_id, data, version, seq, client_id')
            .eq('plan_id', this.planId).gt('seq', since);
        if (options.exclude && /^[A-Za-z0-9_-]+$/.test(options.exclude)) {
            query = query.or(`client_id.is.null,client_id.neq.${options.exclude}`);
        }
        let ordered = query.order('seq', { ascending: true }).limit(options.limit);
        if (options.signal) {
            ordered = ordered.abortSignal(options.signal);
        }
        const { data, error } = await ordered;
        if (error) {
            throw rpcError(error);
        }
        return (data ?? []).map((row) => toEntity(row as Record<string, unknown>)).filter((row): row is RemoteEntity => row !== null);
    }

    async push(ops: PushOp[], clientId: string, signal?: AbortSignal): Promise<PushResult> {
        const sb = await supabaseClient();
        const call = sb.rpc('live_push', { p_plan: this.planId, p_ops: ops, p_client: clientId });
        const { data, error } = await (signal ? call.abortSignal(signal) : call);
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

    async subscribe(handlers: TransportHandlers, options: { exclude?: string } = {}): Promise<void> {
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
            // Realtime allows one filter. Filtering out this device's own writes saves sending every
            // change back to its author (half the downlink when working alone); other plans' rows
            // that pass the filter (only plans this account is a member of, by RLS) are dropped here.
            .on('postgres_changes', { event: '*', schema: 'public', table: 'live_entities', filter: options.exclude && /^[A-Za-z0-9_-]+$/.test(options.exclude) ? `client_id=neq.${options.exclude}` : `plan_id=eq.${this.planId}` }, (payload) => {
                const row = (payload.new ?? {}) as Record<string, unknown>;
                if (row.plan_id !== undefined && row.plan_id !== this.planId) {
                    return;
                }
                const entity = toEntity(row);
                if (entity) {
                    handlers.entity(entity);
                } else if ('seq' in row || 'entity_id' in row) {
                    // Realtime leaves out large columns: the content comes with a pull instead.
                    handlers.stale();
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

    async hasAsset(hash: string): Promise<boolean> {
        const sb = await supabaseClient();
        // A signed URL is only issued for an existing object: a few hundred bytes instead of an upload.
        const { data, error } = await sb.storage.from('live-assets').createSignedUrl(`${this.planId}/${hash}`, 60);
        if (error && !missingObject(error as { message?: string; statusCode?: string })) {
            throw error;
        }
        return !error && Boolean(data?.signedUrl);
    }

    async uploadAsset(hash: string, blob: Blob, options: TransferOptions = {}): Promise<void> {
        const sb = await supabaseClient();
        const path = `${this.planId}/${hash}`;
        if (blob.size > TUS_PIECE) {
            // Large pictures go up resumably: a dropped connection continues at the last 6 MB.
            await tusUpload({
                endpoint: `${URL_!.replace(/\/+$/, '')}/storage/v1/upload/resumable`,
                // Asked per attempt: a long upload outlives the access token.
                headers: async () => {
                    const token = (await sb.auth.getSession()).data.session?.access_token;
                    if (!token) {
                        throw new Error('unauthenticated');
                    }
                    return { authorization: `Bearer ${token}`, apikey: KEY ?? '', 'x-upsert': 'false' };
                },
                bucket: 'live-assets',
                object: path,
                contentType: blob.type || 'application/octet-stream',
            }, blob, { ...options, fetcher: stallFetch });
            return;
        }
        options.onProgress?.({ done: 0, total: blob.size });
        const { error } = await sb.storage.from('live-assets').upload(path, blob, { contentType: blob.type, upsert: false });
        if (error && !/exist|duplicate/i.test(error.message)) {
            throw error;
        }
        options.onProgress?.({ done: blob.size, total: blob.size });
    }

    async downloadAsset(hash: string, options: TransferOptions = {}): Promise<Blob | null> {
        const sb = await supabaseClient();
        const path = `${this.planId}/${hash}`;
        // Asked again when the server refuses an old link (it expired during a slow download).
        const link = async () => {
            const { data, error } = await sb.storage.from('live-assets').createSignedUrl(path, 3600);
            if (error || !data?.signedUrl) {
                throw missingObject(error as { message?: string; statusCode?: string } | null) ? Object.assign(new Error('missing'), { permanent: true }) : (error ?? new Error('link'));
            }
            return data.signedUrl;
        };
        try {
            return new Blob([await rangeDownload(link, hash, { ...options, fetcher: stallFetch })]);
        } catch (failure) {
            if ((failure as { permanent?: boolean }).permanent && /missing|HTTP 40[04]|HTTP 410/.test((failure as Error).message)) {
                // Not uploaded (yet): try again later.
                return null;
            }
            throw failure;
        }
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
