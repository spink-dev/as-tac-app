import { FORMAT_VERSION, type Layer, type LngLat, type Project, type Settings, type Team } from './schema';

export function uid(prefix = ''): string {
    const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return prefix ? `${prefix}_${raw}` : raw;
}

export function nowIso(): string {
    return new Date().toISOString();
}

export const DEFAULT_SETTINGS: Settings = {
    returnToSelect: true,
    directManipulation: true,
    keepBriefingInk: false,
    legLabels: true,
    grid: 'off',
    basemapLabels: true,
    unitScale: 1,
};

export function createLayer(name: string): Layer {
    return { id: uid('layer'), name, visible: true, opacity: 1, locked: false };
}

export interface NewProjectInput {
    name: string;
    areaId: string | null;
    center?: LngLat;
    zoom?: number;
}

export function createProject(input: NewProjectInput): Project {
    const now = nowIso();
    return {
        id: uid(),
        formatVersion: FORMAT_VERSION,
        name: input.name.trim() || 'Neuer Plan',
        createdAt: now,
        updatedAt: now,
        areaId: input.areaId,
        view: input.center ? { center: input.center, zoom: input.zoom ?? 14, bearing: 0 } : undefined,
        layers: [createLayer('Plan')],
        elements: [],
        drawings: [],
        images: [],
        teams: [],
        phases: [],
        log: [],
        tracks: [],
        settings: { ...DEFAULT_SETTINGS },
    };
}

export const TEAM_COLORS = ['#2f6fc4', '#c8393f', '#2f9d5e', '#d08a1e', '#7a4cc2', '#1f9aa6', '#b5487f', '#6b7a2a'];

export function createTeam(index: number, name?: string): Team {
    return {
        id: uid('team'),
        name: name ?? `Team ${index + 1}`,
        color: TEAM_COLORS[index % TEAM_COLORS.length],
        side: 'friendly',
        displayMode: 'icon',
        symbol: 'chevron',
    };
}

export function duplicateProject(project: Project, name: string): Project {
    const now = nowIso();
    const copy = structuredClone(project);
    copy.id = uid();
    copy.name = name;
    copy.createdAt = now;
    copy.updatedAt = now;
    return copy;
}
