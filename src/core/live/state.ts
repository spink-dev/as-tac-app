import { create } from 'zustand';
import type { LiveConflict } from './session';

export type LiveStatus = 'off' | 'connecting' | 'online' | 'offline' | 'error';
export type LiveRole = 'owner' | 'admin' | 'viewer';

export interface Presence {
    clientId: string;
    name: string;
    role: LiveRole;
    color: string;
    selection?: string[];
    leading?: boolean;
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
    presence: Presence[];
    chat: ChatMessage[];
    unread: number;
    leaderId: string | null;
    following: boolean;
    error: string | null;
    conflicts: LiveConflict[];
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
    following: false,
    error: null,
    conflicts: [],
}));

export function resetLive() {
    useLive.setState({ status: 'off', backend: null, remoteId: null, role: null, queued: 0, presence: [], chat: [], unread: 0, leaderId: null, following: false, error: null, conflicts: [] });
}
