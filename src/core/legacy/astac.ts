import { createLayer, createProject, uid } from '../model/factory';
import type { Element, LngLat, MarkerType, Project, Stroke, ZonePattern } from '../model/schema';

/** as-tac ≤ 0.6 plan document (schema 1/2, WGS84). Treated as untrusted input. */
interface OldGeometry {
    type: 'Point' | 'LineString' | 'Polygon' | 'Circle';
    coordinates?: unknown;
    center?: unknown;
    radiusMeters?: unknown;
}
interface OldElement {
    id: string;
    type: 'point' | 'line' | 'polygon' | 'circle' | 'text' | 'freehand';
    geometry: OldGeometry;
    label?: string;
    notes?: string;
    layerId?: string;
    sourceId?: string;
    teamId?: string;
    phaseIds?: string[];
    style?: { colour?: unknown; width?: unknown; opacity?: unknown; symbol?: unknown; pattern?: unknown };
    deletedAt?: string;
}
export interface OldProject {
    id: string;
    schemaVersion: number;
    name: string;
    mapPackageId?: string;
    workspace?: { layers?: { id: string; name: string; opacity?: number; locked?: boolean }[]; siteId?: string; eventId?: string; edition?: string; source?: string };
    teams?: { id: string; name: string; shortLabel?: string; colour?: string }[];
    phases?: { id: string; order?: number; title?: string; notes?: string; camera?: { center: [number, number]; zoom: number; bearing?: number } | null; visibleElementIds?: string[] }[];
    elements?: OldElement[];
}

const HEX = /^#[0-9a-f]{6}$/i;

function point(value: unknown): LngLat | null {
    if (Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
        && Math.abs(value[0] as number) <= 180 && Math.abs(value[1] as number) <= 85) {
        return [value[0] as number, value[1] as number];
    }
    return null;
}

function points(value: unknown): LngLat[] {
    return Array.isArray(value) ? value.map(point).filter((p): p is LngLat => p !== null) : [];
}

function text(value: unknown, max: number): string | undefined {
    return typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined;
}

function str(value: unknown, max: number): string {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

function list<T = unknown>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

function cleanId(value: unknown): string | null {
    const id = typeof value === 'string' ? value.trim().slice(0, 80) : '';
    return id ? id : null;
}

/** 0.6 showed only listed elements in a phase; unlisted ones were hidden in every briefing phase. */
export const NO_BRIEFING_PHASE = 'no-briefing';

function markerType(symbol: unknown, sourceId: string | undefined): MarkerType {
    switch (symbol) {
        case 'flag':
            return 'hq';
        case 'warning':
            return 'danger';
        case 'building':
            return 'poi';
        case 'aid':
            return 'medic';
        case 'shield':
            return 'flag';
        default:
            return typeof sourceId === 'string' && sourceId.includes('poi') ? 'poi' : 'custom';
    }
}

function pattern(value: string | undefined): ZonePattern | undefined {
    switch (value) {
        case 'hatch':
            return 'hatch';
        case 'cross':
            return 'cross';
        case 'outline':
            return 'none';
        case 'solid':
        case 'dots':
            return 'solid';
        default:
            return undefined;
    }
}

export function isOldProject(value: unknown): value is OldProject {
    const v = value as OldProject;
    return !!v && typeof v === 'object' && typeof v.id === 'string' && typeof v.name === 'string'
        && (v.schemaVersion === 1 || v.schemaVersion === 2) && Array.isArray(v.elements);
}

/** Convert an as-tac 0.x plan into the 1.0 model. Unknown or broken items are skipped, not guessed. */
export function convertOldProject(old: OldProject, areaId: string | null): Project {
    const project = createProject({ name: text(old.name, 120) ?? 'Plan', areaId });
    const workspace = old.workspace && typeof old.workspace === 'object' ? old.workspace : undefined;
    const layerSeen = new Set<string>();
    const layers = [];
    for (const layer of list<{ id: unknown; name: unknown; opacity?: unknown; locked?: unknown }>(workspace?.layers)) {
        const id = cleanId(layer?.id);
        if (!id || layerSeen.has(id) || layers.length >= 64) {
            continue;
        }
        layerSeen.add(id);
        const opacity = Number(layer.opacity);
        layers.push({ id, name: text(layer.name, 80) ?? 'Ebene', visible: true, opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1, locked: layer.locked === true });
    }
    if (layers.length > 0) {
        project.layers = layers;
    }
    if (workspace && typeof workspace.siteId === 'string' && workspace.siteId) {
        project.event = { siteId: str(workspace.siteId, 80), eventId: str(workspace.eventId, 80), edition: str(workspace.edition, 120), source: str(workspace.source, 400) || 'as-tac 0.x' };
    }
    const teamSeen = new Set<string>();
    for (const team of list<{ id: unknown; name: unknown; shortLabel?: unknown; colour?: unknown }>(old.teams)) {
        const id = cleanId(team?.id);
        if (!id || teamSeen.has(id) || project.teams.length >= 200) {
            continue;
        }
        teamSeen.add(id);
        project.teams.push({
            id, name: text(team.name, 80) ?? 'Team', unitNumber: text(team.shortLabel, 12),
            color: typeof team.colour === 'string' && HEX.test(team.colour) ? team.colour : '#2f6fc4', side: 'friendly', displayMode: 'icon', symbol: 'infantry',
        });
    }
    type OldPhase = { id: unknown; order?: unknown; title?: unknown; notes?: unknown; camera?: { center?: unknown; zoom?: unknown; bearing?: unknown } | null; visibleElementIds?: unknown };
    const phaseSeen = new Set<string>();
    const phases: { id: string; raw: OldPhase }[] = [];
    for (const raw of list<OldPhase>(old.phases)) {
        const id = cleanId(raw?.id);
        if (id && !phaseSeen.has(id) && id !== NO_BRIEFING_PHASE && phases.length < 100) {
            phaseSeen.add(id);
            phases.push({ id, raw });
        }
    }
    phases.sort((a, b) => (Number(a.raw.order) || 0) - (Number(b.raw.order) || 0));
    project.phases = phases.map(({ id, raw }, i) => {
        const center = point(raw.camera?.center);
        const zoom = Number(raw.camera?.zoom);
        const bearing = Number(raw.camera?.bearing);
        return {
            id, name: text(raw.title, 120) ?? `Phase ${i + 1}`, notes: text(raw.notes, 8000),
            camera: center ? { center, zoom: Number.isFinite(zoom) ? Math.min(24, Math.max(0, zoom)) : 14, bearing: Number.isFinite(bearing) ? bearing : 0 } : undefined,
        };
    });
    const membership = new Map<string, string[]>();
    for (const { id, raw } of phases) {
        for (const elementId of list(raw.visibleElementIds)) {
            const key = cleanId(elementId);
            if (key) {
                membership.set(key, [...(membership.get(key) ?? []), id]);
            }
        }
    }
    const phaseIdsFor = (id: string): string[] | undefined => {
        if (phases.length === 0) {
            return undefined;
        }
        const listed = [...new Set(membership.get(id) ?? [])];
        if (listed.length === phases.length) {
            return undefined;
        }
        return listed.length > 0 ? listed : [NO_BRIEFING_PHASE];
    };
    const elements: Element[] = [];
    const drawings: Stroke[] = [];
    const seen = new Set<string>();
    for (const raw of list<OldElement>(old.elements)) {
        if (!raw || typeof raw !== 'object' || raw.deletedAt) {
            continue;
        }
        const id = cleanId(raw.id);
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        const style = raw.style && typeof raw.style === 'object' ? raw.style : {};
        const color = typeof style.colour === 'string' && HEX.test(style.colour) ? style.colour : undefined;
        const layerId = cleanId(raw.layerId);
        const teamId = cleanId(raw.teamId);
        const base = {
            id,
            layerId: layerId && layerSeen.has(layerId) ? layerId : undefined,
            teamId: teamId && teamSeen.has(teamId) ? teamId : undefined,
            label: text(raw.label, 160), notes: text(raw.notes, 8000), sourceId: text(raw.sourceId, 120), color, phaseIds: phaseIdsFor(id),
        };
        const width = Number(style.width);
        const g = raw.geometry && typeof raw.geometry === 'object' ? raw.geometry : ({} as OldGeometry);
        switch (raw.type) {
            case 'point': {
                const pos = point(g.coordinates);
                if (pos) {
                    elements.push({ kind: 'marker', ...base, pos, type: markerType(style.symbol, base.sourceId) });
                }
                break;
            }
            case 'text': {
                const pos = point(g.coordinates);
                if (pos) {
                    elements.push({ kind: 'text', ...base, pos, text: (base.label ?? '').slice(0, 400) });
                }
                break;
            }
            case 'line': {
                const line = points(g.coordinates).slice(0, 5000);
                if (line.length >= 2) {
                    elements.push({ kind: 'route', ...base, points: line, style: 'planned', arrow: false, width: Number.isFinite(width) ? Math.min(16, Math.max(1, width)) : 3 });
                }
                break;
            }
            case 'polygon': {
                const ring = points(list(g.coordinates)[0]);
                const open = (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring).slice(0, 5000);
                if (open.length >= 3) {
                    const safe = /safe/i.test(base.label ?? '');
                    elements.push({
                        kind: 'zone', ...base, shape: { type: 'polygon', points: open }, category: safe ? 'safe' : 'custom',
                        fillOpacity: 0.18, pattern: pattern(typeof style.pattern === 'string' ? style.pattern : undefined) ?? (safe ? 'hatch' : undefined),
                    });
                }
                break;
            }
            case 'circle': {
                const center = point(g.center);
                const radius = Number(g.radiusMeters);
                if (center && radius > 0 && radius < 200000) {
                    elements.push({ kind: 'zone', ...base, shape: { type: 'circle', center, radiusM: radius }, category: 'custom', fillOpacity: 0.18, pattern: pattern(typeof style.pattern === 'string' ? style.pattern : undefined) });
                }
                break;
            }
            case 'freehand': {
                const line = points(g.coordinates).slice(0, 4000);
                if (line.length >= 2) {
                    drawings.push({
                        id, points: line, color: color ?? '#e8402a', width: Number.isFinite(width) ? Math.min(24, Math.max(1, width)) : 4, opacity: 0.95,
                        layerId: base.layerId, phaseIds: base.phaseIds,
                    });
                }
                break;
            }
        }
    }
    project.elements = elements.slice(0, 20000);
    project.drawings = drawings.slice(0, 5000);
    if (project.layers.length === 0) {
        project.layers = [createLayer('Plan')];
    }
    project.id = uid();
    return project;
}
