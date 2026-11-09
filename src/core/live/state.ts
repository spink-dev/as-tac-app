import { create } from 'zustand';
import type { LiveConflict } from './session';

/** `limited`: the server is reachable over HTTP but realtime isn't; changes are polled. */
export type LiveStatus = 'off' | 'connecting' | 'online' | 'limited' | 'offline' | 'error';
export type LiveRole = 'owner' | 'admin' | 'viewer';

export interface Presence {
    clientId: string;
    name: string;
    role: LiveRole;
    color: string;
    selection?: string[];
    /** Account behind this device, filled in from the membership list (not self-reported). */
    userId?: string;
}

export interface ChatMessage {
    id: string;
    author: string;
    authorName: string;
    body: string;
    createdAt: string;
}

interface LiveState {
    status: LiveStatus;
    backend: 'supabase' | 'loopback' | null;
    remoteId: string | null;
    role: LiveRole | null;
    queued: number;
    /** Objects received so far in a running catch-up, `null` when none runs. */
    receiving: number | null;
    /** Pictures moving right now (image maps, logos), by hash. */
    transfers: Record<string, { dir: 'up' | 'down'; done: number; total: number | null }>;
    /** Pictures of this plan not on this device (yet). */
    missing: string[];
    presence: Presence[];
    chat: ChatMessage[];
    unread: number;
    leaderId: string | null;
    leaderName: string | null;
    following: boolean;
    error: string | null;
    conflicts: LiveConflict[];
    /** A partner's app writes a newer plan format: this device holds its changes until it is updated. */
    outdated: number | null;
}

export const useLive = create<LiveState>(() => ({
    status: 'off',
    backend: null,
    remoteId: null,
    role: null,
    queued: 0,
    presence: [],
    chat: [],
    unread: 0,
    leaderId: null,
    leaderName: null,
    receiving: null,
    transfers: {},
    missing: [],
    following: false,
    error: null,
    conflicts: [],
    outdated: null,
}));

export function resetLive() {
    useLive.setState({ status: 'off', backend: null, remoteId: null, role: null, queued: 0, receiving: null, transfers: {}, missing: [], presence: [], chat: [], unread: 0, leaderId: null, leaderName: null, following: false, error: null, conflicts: [], outdated: null });
}
