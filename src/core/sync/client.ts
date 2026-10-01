import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateProject, type Project } from '../projects/model';
export type Role = 'owner' | 'admin' | 'viewer';
export interface OnlineProject { id: string; document: Project; server_seq: number; versions: Record<string, number> }
export interface OnlineChange { kind: 'project' | 'element' | 'team' | 'phase'; id: string; value: unknown; expectedVersion: number }
export interface OnlineOperation { project_id: string; op_id: string; actor_id: string; server_seq: number; payload: { projectVersion: number; changes: OnlineChange[] }; versions: Record<string, number> }
let client: SupabaseClient | null | undefined;
export function onlineClient() {
    if (client !== undefined) {
        return client;
    }
    const url = import.meta.env.PUBLIC_SUPABASE_URL;
    const key = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
        client = null;
        return client;
    }
    const parsed = new URL(url);
    let publicKey = key.startsWith('sb_publishable_');
    try {
        publicKey ||= JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon';
    } catch {
        // Modern publishable keys are not JWTs.
    }
    if (!publicKey || parsed.username || parsed.password) {
        throw new Error('Only a public publishable key is allowed');
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
        throw new Error('Online endpoint requires HTTPS');
    }
    client = createClient(url, key, { auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: true } });
    return client;
}
export class OnlineApi {
    constructor(readonly client: SupabaseClient) {
    }
    async list(): Promise<OnlineProject[]> {
        const { data, error } = await this.client.from('ast_projects').select('id,document,server_seq,versions').order('created_at');
        if (error) {
            throw error;
        }
        return (data ?? []).map(this.validate);
    }
    private validate(value: OnlineProject) {
        validateProject(value.document);
        if (value.id !== value.document.id || !Number.isSafeInteger(value.server_seq) || value.server_seq < 0
            || !value.versions || Object.values(value.versions).some((version) => !Number.isSafeInteger(version) || version < 1)) {
            throw new Error('Invalid online snapshot');
        }
        return value;
    }
    async create(name: string, map: string): Promise<void> {
        const { error } = await this.client.rpc('ast_create_project', { p_id: crypto.randomUUID(), p_name: name, p_map: map });
        if (error) {
            throw error;
        }
    }
    async members(project: string): Promise<{ user_id: string; role: Role }[]> {
        const { data, error } = await this.client.from('ast_memberships').select('user_id,role').eq('project_id', project);
        if (error) {
            throw error;
        }
        return data ?? [];
    }
    async setMember(project: string, user: string, role: 'admin' | 'viewer' | null) {
        const { error } = await this.client.rpc('ast_set_member', { p_project: project, p_user: user, p_role: role });
        if (error) {
            throw error;
        }
    }
    // Keep opId and payload unchanged when retrying an uncertain request.
    async apply(project: string, opId: string, projectVersion: number, changes: OnlineChange[]): Promise<OnlineOperation> {
        const { data, error } = await this.client.rpc('ast_apply', { p_project: project, p_op: opId, p_project_version: projectVersion, p_changes: changes });
        if (error) {
            throw error;
        }
        return data;
    }
    async replay(project: string, after: number): Promise<OnlineOperation[]> {
        if (!Number.isSafeInteger(after) || after < 0) {
            throw new Error('Invalid replay cursor');
        }
        const { data, error } = await this.client.from('ast_operations').select('*').eq('project_id', project).gt('server_seq', after).order('server_seq').limit(200);
        if (error) {
            throw error;
        }
        return data ?? [];
    }
}
