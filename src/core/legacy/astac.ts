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
    style?: { colour?: string; width?: number; opacity?: number; symbol?: string; pattern?: string };
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

function markerType(symbol: string | undefined, sourceId: string | undefined): MarkerType {
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
            return sourceId?.includes('poi') ? 'poi' : 'custom';
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
    const layers = (old.workspace?.layers ?? []).filter((layer) => typeof layer?.id === 'string' && typeof layer.name === 'string');
    if (layers.length > 0) {
        project.layers = layers.slice(0, 64).map((layer) => ({
            id: layer.id.slice(0, 80), name: layer.name.slice(0, 80) || 'Ebene', visible: true,
            opacity: Number.isFinite(layer.opacity) ? Math.min(1, Math.max(0, layer.opacity as number)) : 1, locked: Boolean(layer.locked),
        }));
    }
    const layerIds = new Set(project.layers.map((layer) => layer.id));
    if (old.workspace?.siteId) {
        project.event = {
            siteId: old.workspace.siteId.slice(0, 80), eventId: (old.workspace.eventId ?? '').slice(0, 80),
            edition: (old.workspace.edition ?? '').slice(0, 120), source: (old.workspace.source ?? 'as-tac 0.x').slice(0, 400),
        };
    }
    project.teams = (old.teams ?? []).filter((team) => typeof team?.id === 'string' && typeof team.name === 'string').slice(0, 200).map((team) => ({
        id: team.id.slice(0, 80), name: team.name.slice(0, 80) || 'Team', unitNumber: text(team.shortLabel, 12),
        color: HEX.test(team.colour ?? '') ? (team.colour as string) : '#2f6fc4', side: 'friendly', displayMode: 'icon', symbol: 'infantry',
    }));
    const phases = [...(old.phases ?? [])].filter((phase) => typeof phase?.id === 'string').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).slice(0, 100);
    project.phases = phases.map((phase, i) => {
        const center = point(phase.camera?.center);
        return {
            id: phase.id.slice(0, 80), name: text(phase.title, 120) ?? `Phase ${i + 1}`, notes: text(phase.notes, 8000),
            camera: center && phase.camera ? { center, zoom: Math.min(24, Math.max(0, Number(phase.camera.zoom) || 14)), bearing: Number(phase.camera.bearing) || 0 } : undefined,
        };
    });
    const phaseMembership = new Map<string, string[]>();
    for (const phase of phases) {
        for (const id of phase.visibleElementIds ?? []) {
            phaseMembership.set(id, [...(phaseMembership.get(id) ?? []), phase.id]);
        }
    }
    const elements: Element[] = [];
    const drawings: Stroke[] = [];
    const seen = new Set<string>();
    for (const old_ of old.elements ?? []) {
        if (!old_ || typeof old_.id !== 'string' || old_.deletedAt || seen.has(old_.id)) {
            continue;
        }
        seen.add(old_.id);
        const color = HEX.test(old_.style?.colour ?? '') ? old_.style?.colour : undefined;
        const listed = phaseMembership.get(old_.id) ?? old_.phaseIds ?? [];
        const phaseIds = listed.length > 0 && listed.length < phases.length ? listed.slice(0, 200) : undefined;
        const base = {
            id: old_.id.slice(0, 80),
            layerId: old_.layerId && layerIds.has(old_.layerId) ? old_.layerId : undefined,
            teamId: old_.teamId && project.teams.some((team) => team.id === old_.teamId) ? old_.teamId : undefined,
            label: text(old_.label, 160), notes: text(old_.notes, 8000), sourceId: text(old_.sourceId, 120), color, phaseIds,
        };
        const g = old_.geometry ?? ({} as OldGeometry);
        switch (old_.type) {
            case 'point': {
                const pos = point(g.coordinates);
                if (pos) {
                    elements.push({ kind: 'marker', ...base, pos, type: markerType(old_.style?.symbol, old_.sourceId) });
                }
                break;
            }
            case 'text': {
                const pos = point(g.coordinates);
                if (pos) {
                    elements.push({ kind: 'text', ...base, pos, text: base.label ?? '' });
                }
                break;
            }
            case 'line': {
                const line = points(g.coordinates);
                if (line.length >= 2) {
                    elements.push({ kind: 'route', ...base, points: line, style: 'planned', arrow: false, width: Math.min(16, Math.max(1, Number(old_.style?.width) || 3)) });
                }
                break;
            }
            case 'polygon': {
                const ring = points(Array.isArray(g.coordinates) ? (g.coordinates as unknown[])[0] : undefined);
                const open = ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
                if (open.length >= 3) {
                    const safe = /safe/i.test(base.label ?? '');
                    elements.push({
                        kind: 'zone', ...base, shape: { type: 'polygon', points: open }, category: safe ? 'safe' : 'custom',
                        fillOpacity: 0.18, pattern: pattern(old_.style?.pattern) ?? (safe ? 'hatch' : undefined),
                    });
                }
                break;
            }
            case 'circle': {
                const center = point(g.center);
                const radius = Number(g.radiusMeters);
                if (center && radius > 0 && radius < 200000) {
                    elements.push({ kind: 'zone', ...base, shape: { type: 'circle', center, radiusM: radius }, category: 'custom', fillOpacity: 0.18, pattern: pattern(old_.style?.pattern) });
                }
                break;
            }
            case 'freehand': {
                const line = points(g.coordinates);
                if (line.length >= 2) {
                    drawings.push({ id: base.id, points: line.slice(0, 4000), color: color ?? '#e8402a', width: Math.min(24, Math.max(1, Number(old_.style?.width) || 4)), opacity: 0.95, layerId: base.layerId });
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
