import type { TransferProgress } from './transfer';
import type { LiveRole, Presence, ChatMessage } from './state';

/** Server-side collections: plan collections plus `meta` (name, area, settings) and `order` (id sequences). */
export type RemoteCollection = 'meta' | 'order' | 'layers' | 'teams' | 'images' | 'phases' | 'elements' | 'drawings' | 'log';

export interface RemoteEntity {
    collection: RemoteCollection;
    entityId: string;
    data: unknown | null;
    version: number;
    seq: number;
    clientId: string | null;
}

export interface PushOp {
    collection: RemoteCollection;
    entityId: string;
    data: unknown | null;
    /** Version this change was based on; 0 = the entity is new. */
    base: number;
}

export interface PushResult {
    applied: { collection: RemoteCollection; entityId: string; version: number; seq: number }[];
    conflicts: { collection: RemoteCollection; entityId: string; version: number; data: unknown | null }[];
}

export interface BriefingMessage {
    type: 'briefing';
    from: string;
    /** Sender's display name (only owners and admins can broadcast). */
    name?: string;
    /** `false` ends the sender's leadership; leaders re-send `true` as a heartbeat. */
    leading?: boolean;
    /** With `leading: false`: the admin who takes over (followers keep following). */
    to?: string;
    phaseIndex: number;
    camera: { center: [number, number]; zoom: number; bearing: number } | null;
}

export interface TransferOptions {
    signal?: AbortSignal;
    onProgress?: (progress: TransferProgress) => void;
}

export interface PullOptions {
    /** At most this many rows, ordered by seq (a page covers everything up to its last seq). */
    limit: number;
    signal?: AbortSignal;
    /** Leave out rows written by this client (its own writes are already local). */
    exclude?: string;
}

export interface TransportHandlers {
    entity: (entity: RemoteEntity) => void;
    /** A change was announced without its content; fetch it with a pull. */
    stale: () => void;
    presence: (people: Presence[]) => void;
    briefing: (message: BriefingMessage) => void;
    chat: (message: ChatMessage) => void;
    status: (online: boolean) => void;
}

export interface JoinInfo {
    planId: string;
    name: string;
    areaId: string | null;
    role: LiveRole;
}

/**
 * One live plan on one backend. Supabase in production; the loopback transport runs the same
 * protocol between tabs of one browser (BroadcastChannel + a shared local "server") for testing.
 */
export interface LiveTransport {
    readonly kind: 'supabase' | 'loopback';
    readonly planId: string;
    /** One page of entities changed after `since`. */
    pull(since: number, options: PullOptions): Promise<RemoteEntity[]>;
    push(ops: PushOp[], clientId: string, signal?: AbortSignal): Promise<PushResult>;
    /** `exclude`: don't deliver changes written by this client back to it. */
    subscribe(handlers: TransportHandlers, options?: { exclude?: string }): Promise<void>;
    track(me: Presence): void;
    broadcast(message: BriefingMessage): void;
    createInvite(role: 'admin' | 'viewer'): Promise<string>;
    chatHistory(): Promise<ChatMessage[]>;
    sendChat(body: string): Promise<void>;
    /** Resumable where the backend allows; retries over weak links. */
    uploadAsset(hash: string, blob: Blob, options?: TransferOptions): Promise<void>;
    /** Whether the server already holds this picture (cheap check before an upload). */
    hasAsset(hash: string, signal?: AbortSignal): Promise<boolean>;
    /** `null` when the server doesn't have it (yet); throws on network trouble. */
    downloadAsset(hash: string, options?: TransferOptions): Promise<Blob | null>;
    close(): void;
}

export interface LiveBackend {
    readonly kind: 'supabase' | 'loopback';
    /** Current account on this backend, `null` when signed out. */
    userId(): Promise<string | null>;
    createPlan(name: string, areaId: string | null, displayName: string): Promise<string>;
    redeem(code: string, displayName: string): Promise<JoinInfo>;
    open(planId: string): LiveTransport;
}
