export type AgentKind = 'allow' | 'browser' | 'preview' | 'search' | 'ai' | 'tool' | 'bot';
export type PathKind = 'trap' | 'public' | 'info' | 'info-asset' | 'html' | 'asset';
export type Action = 'allow' | 'info' | 'deny' | 'trap';

export interface Policy {
    format: 'anti-ai-policy';
    version: number;
    name: string;
    origin: string;
    infoPrefix: string;
    infoAssets: string[];
    publicPaths: string[];
    trapPrefix: string;
    requireAcceptLanguage: boolean;
    modes: { search: 'info' | 'deny'; previews: 'info' | 'deny'; ai: 'info' | 'deny' };
    patterns: Record<'allow' | 'previewFirst' | 'preview' | 'search' | 'ai' | 'tool' | 'bot', string | null>;
    robotsTag: { info: string; other: string };
    denyBody: string;
    rateLimit: { documentsPerSecond: number; burst: number };
}

export type HeaderSource = { get(name: string): string | null } | Record<string, string | undefined>;

export const KINDS: AgentKind[];
export const PATH_KINDS: PathKind[];
export const AGENT_ORDER: [string, Exclude<AgentKind, 'browser'>][];
export const BROWSER_TOKENS: string[];
export function namesPattern(names: string[]): string | null;
export function compilePolicy(site: unknown, lists: { aiRobots: Record<string, unknown>; agents: Record<string, unknown> }): Policy;
export function normalisePath(pathname: string): string;
export function pathKind(path: string, policy: Policy): PathKind;
export function agentKind(headers: HeaderSource, policy: Policy): AgentKind;
export function decideKinds(kind: AgentKind, path: PathKind, hasLanguage: boolean, policy: Policy): Action;
export function decide(request: { path: string; headers: HeaderSource }, policy: Policy): { action: Action; kind: AgentKind; pathKind: PathKind; robotsTag: string };
