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
    phaseIndex: number;
    camera: { center: [number, number]; zoom: number; bearing: number } | null;
}

export interface TransportHandlers {
    entity: (entity: RemoteEntity) => void;
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
    pull(since: number): Promise<RemoteEntity[]>;
    push(ops: PushOp[], clientId: string): Promise<PushResult>;
    subscribe(handlers: TransportHandlers): Promise<void>;
    track(me: Presence): void;
    broadcast(message: BriefingMessage): void;
    createInvite(role: 'admin' | 'viewer'): Promise<string>;
    chatHistory(): Promise<ChatMessage[]>;
    sendChat(body: string): Promise<void>;
    uploadAsset(hash: string, blob: Blob): Promise<void>;
    downloadAsset(hash: string): Promise<Blob | null>;
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
