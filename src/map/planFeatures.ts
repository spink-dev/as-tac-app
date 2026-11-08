import type { Element, LngLat, Project, Stroke, Team, Zone, ZoneCategory, MarkerType, RouteStyle } from '../core/model/schema';
import type { Mode, StreamerProfile } from '../core/store/ui';
import { bearingDeg, centroid, circlePolygon, distanceM, formatBearing, formatDistance, formatMils, midpoint } from '../core/geo/geo';
import { markerIconId } from './icons';

export const MARKER_COLORS: Record<MarkerType, string> = {
    unit: '#2f6fc4', enemy: '#d0343c', objective: '#e09a1a', medic: '#d0343c', respawn: '#2f9d5e',
    danger: '#e8b100', hq: '#2f6fc4', custom: '#6b7a8c', poi: '#4b5563', flag: '#d0343c',
};
export const ROUTE_COLORS: Record<RouteStyle, string> = { planned: '#2f6fc4', actual: '#2f9d5e', alternative: '#d08a1e', boundary: '#c8393f' };
export const ZONE_COLORS: Record<ZoneCategory, string> = {
    ao: '#2f6fc4', nogo: '#c8393f', respawn: '#2f9d5e', objective: '#e09a1a', danger: '#e8b100', safe: '#e8c24d', civil: '#c9b58a', custom: '#7a4cc2',
};
export const ZONE_PATTERN: Record<ZoneCategory, 'solid' | 'hatch' | 'cross' | 'none'> = {
    ao: 'none', nogo: 'cross', respawn: 'solid', objective: 'solid', danger: 'hatch', safe: 'hatch', civil: 'solid', custom: 'solid',
};
const ANON = '#7b8189';

export interface RenderContext {
    mode: Mode;
    phaseId: string | null;
    streamer: StreamerProfile;
    selection: Set<string>;
    bearingUnit: 'deg' | 'mil';
    briefingInk: Stroke[];
    streamerInk: Stroke[];
    hideIds?: Set<string>;
}

export interface PlanCollections {
    zones: GeoJSON.FeatureCollection;
    lines: GeoJSON.FeatureCollection;
    points: GeoJSON.FeatureCollection;
    labels: GeoJSON.FeatureCollection;
    ink: GeoJSON.FeatureCollection;
}

export function teamMap(project: Project): Map<string, Team> {
    return new Map(project.teams.map((team) => [team.id, team]));
}

/** Formation identity is shared only when the squad opts in. */
export function visualTeam(team: Team | undefined, teams: Map<string, Team>): Team | undefined {
    if (!team || !team.inheritFormationVisual || !team.formationId) {
        return team;
    }
    const parent = [...teams.values()].find((other) => other.formationId === team.formationId && !other.inheritFormationVisual);
    return parent ? { ...team, color: parent.color, symbol: parent.symbol, displayMode: parent.displayMode, logoAsset: parent.logoAsset } : team;
}

export function elementColor(element: Element, teams: Map<string, Team>): string {
    const team = visualTeam(element.teamId ? teams.get(element.teamId) : undefined, teams);
    if (element.color) {
        return element.color;
    }
    if (team && element.kind !== 'zone') {
        return team.color;
    }
    switch (element.kind) {
        case 'marker':
            return MARKER_COLORS[element.type];
        case 'route':
            return ROUTE_COLORS[element.style];
        case 'zone':
            return team?.color ?? ZONE_COLORS[element.category];
        case 'bearing':
            return '#14181b';
        default:
            return '#14181b';
    }
}

export function zoneRing(zone: Zone): LngLat[] {
    if (zone.shape.type === 'circle') {
        return circlePolygon(zone.shape.center, zone.shape.radiusM, 72);
    }
    const ring = [...zone.shape.points];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push(first);
    }
    return ring;
}

export function zoneLabelPos(zone: Zone): LngLat {
    if (zone.labelPos) {
        return zone.labelPos;
    }
    return zone.shape.type === 'circle' ? zone.shape.center : centroid(zone.shape.points);
}

export function visibleInPhase(phaseIds: string[] | undefined, phaseId: string | null): boolean {
    return !phaseId || !phaseIds || phaseIds.length === 0 || phaseIds.includes(phaseId);
}

/** Which elements does the current context allow on the map? */
export function isElementVisible(element: Element, project: Project, ctx: RenderContext): boolean {
    const layer = project.layers.find((l) => l.id === element.layerId) ?? project.layers[0];
    if (layer && !layer.visible) {
        return false;
    }
    if (ctx.hideIds?.has(element.id)) {
        return false;
    }
    if (ctx.mode === 'briefing' && !visibleInPhase(element.phaseIds, ctx.phaseId)) {
        return false;
    }
    if (ctx.streamer !== 'off') {
        if (element.kind === 'bearing') {
            return false;
        }
        if (element.kind === 'route' && element.style !== 'boundary') {
            return false;
        }
        if (ctx.streamer === 'public' && (element.kind === 'zone' || element.kind === 'text')) {
            return false;
        }
    }
    return true;
}

function legLabel(a: LngLat, b: LngLat, unit: 'deg' | 'mil'): string {
    const bearing = bearingDeg(a, b);
    return `${unit === 'mil' ? formatMils(bearing) : formatBearing(bearing)} · ${formatDistance(distanceM(a, b))}`;
}

function dashOf(element: Element): 'solid' | 'dash' | 'long' | 'dot' {
    if (element.kind === 'route') {
        return element.style === 'alternative' ? 'dash' : element.style === 'boundary' ? 'long' : 'solid';
    }
    if (element.kind === 'bearing') {
        return 'dot';
    }
    return 'solid';
}

export function buildPlanCollections(project: Project, ctx: RenderContext, unitScale: number, legLabels: boolean): PlanCollections {
    const teams = teamMap(project);
    const layerOpacity = new Map(project.layers.map((layer) => [layer.id, layer.opacity]));
    const defaultLayer = project.layers[0]?.id;
    const zones: GeoJSON.Feature[] = [];
    const lines: GeoJSON.Feature[] = [];
    const points: GeoJSON.Feature[] = [];
    const labels: GeoJSON.Feature[] = [];
    const ink: GeoJSON.Feature[] = [];
    const publicMode = ctx.streamer === 'public';

    for (const element of project.elements) {
        if (!isElementVisible(element, project, ctx)) {
            continue;
        }
        const sel = ctx.selection.has(element.id) ? 1 : 0;
        const op = layerOpacity.get(element.layerId ?? defaultLayer ?? '') ?? 1;
        const team = visualTeam(element.teamId ? teams.get(element.teamId) : undefined, teams);
        let color = elementColor(element, teams);
        const base = { id: element.id, kind: element.kind, sel, op, locked: element.locked ? 1 : 0 };
        switch (element.kind) {
            case 'zone': {
                const ring = zoneRing(element);
                const pattern = element.pattern ?? ZONE_PATTERN[element.category];
                zones.push({
                    type: 'Feature', id: element.id,
                    properties: { ...base, color, fillOp: pattern === 'none' ? 0 : element.fillOpacity, pattern: pattern === 'hatch' || pattern === 'cross' ? `pat|${pattern}|${color}` : '', dash: element.category === 'nogo' ? 'dash' : 'solid' },
                    geometry: { type: 'Polygon', coordinates: [ring] },
                });
                const statusText = element.objectiveStatus && element.objectiveStatus !== 'unknown' ? ` · ${element.objectiveStatus.toUpperCase()}` : '';
                if (element.label) {
                    labels.push({ type: 'Feature', properties: { ...base, color, text: `${element.label}${statusText}`, size: 13, role: 'zone' }, geometry: { type: 'Point', coordinates: zoneLabelPos(element) } });
                }
                break;
            }
            case 'route': {
                lines.push({
                    type: 'Feature', id: element.id,
                    properties: { ...base, color, width: element.width ?? (element.style === 'boundary' ? 3.5 : 3), dash: dashOf(element), arrow: element.arrow ? 1 : 0 },
                    geometry: { type: 'LineString', coordinates: element.points },
                });
                const last = element.points[element.points.length - 1];
                const prev = element.points[element.points.length - 2];
                if (element.arrow) {
                    points.push({ type: 'Feature', properties: { ...base, role: 'head', icon: `head|${color}`, rot: bearingDeg(prev, last) - 90 }, geometry: { type: 'Point', coordinates: last } });
                }
                if (legLabels && ctx.streamer === 'off' && element.style !== 'boundary') {
                    for (let i = 1; i < element.points.length; i++) {
                        const a = element.points[i - 1];
                        const b = element.points[i];
                        if (distanceM(a, b) >= 25) {
                            labels.push({ type: 'Feature', properties: { ...base, color, text: legLabel(a, b, ctx.bearingUnit), size: 11, role: 'leg' }, geometry: { type: 'Point', coordinates: midpoint(a, b) } });
                        }
                    }
                }
                const name = element.label || (team?.unitNumber ?? '');
                if (name && !publicMode) {
                    labels.push({ type: 'Feature', properties: { ...base, color, text: name, size: 12, role: 'route' }, geometry: { type: 'Point', coordinates: element.points[0] } });
                }
                break;
            }
            case 'bearing': {
                lines.push({ type: 'Feature', id: element.id, properties: { ...base, color, width: 2, dash: 'dot', arrow: 0 }, geometry: { type: 'LineString', coordinates: [element.start, element.end] } });
                points.push({ type: 'Feature', properties: { ...base, role: 'head', icon: `head|${color}`, rot: bearingDeg(element.start, element.end) - 90 }, geometry: { type: 'Point', coordinates: element.end } });
                labels.push({ type: 'Feature', properties: { ...base, color, text: `${element.label ? `${element.label} · ` : ''}${legLabel(element.start, element.end, ctx.bearingUnit)}`, size: 12, role: 'leg' }, geometry: { type: 'Point', coordinates: midpoint(element.start, element.end) } });
                break;
            }
            case 'marker': {
                let symbol = element.symbol ?? (element.type === 'unit' || element.type === 'enemy' ? team?.symbol ?? '' : '');
                let text = element.label ?? '';
                const isFriendly = element.type === 'unit' || element.type === 'hq';
                if (isFriendly && team?.unitNumber) {
                    text = text ? `${team.unitNumber} · ${text}` : team.unitNumber;
                }
                if (publicMode && isFriendly) {
                    color = ANON;
                    symbol = 'infantry';
                    text = '';
                }
                const scale = element.type === 'unit' ? unitScale : 1;
                const useLogo = !publicMode && element.type === 'unit' && team?.displayMode === 'logo' && team.logoAsset;
                const icon = useLogo ? `logo|${team.logoAsset}|${scale.toFixed(2)}` : markerIconId(element.type, color, symbol, element.objectiveStatus ?? '', scale);
                points.push({
                    type: 'Feature', id: element.id,
                    properties: { ...base, role: 'marker', icon, text, size: element.type === 'poi' ? 10.5 : 12, rot: element.rotation ?? 0, poi: element.type === 'poi' ? 1 : 0 },
                    geometry: { type: 'Point', coordinates: element.pos },
                });
                break;
            }
            case 'text': {
                points.push({
                    type: 'Feature', id: element.id,
                    properties: { ...base, role: 'text', text: element.text || '…', size: element.size ?? 14, color: element.color ?? '' },
                    geometry: { type: 'Point', coordinates: element.pos },
                });
                break;
            }
        }
    }

    const strokes: { stroke: Stroke; session?: boolean }[] = [];
    if (ctx.streamer === 'off') {
        for (const stroke of project.drawings) {
            const layer = project.layers.find((l) => l.id === stroke.layerId);
            if (layer && !layer.visible) {
                continue;
            }
            if (stroke.briefingOnly ? ctx.mode !== 'briefing' : false) {
                continue;
            }
            if (ctx.mode === 'briefing' && !visibleInPhase(stroke.phaseIds, ctx.phaseId)) {
                continue;
            }
            strokes.push({ stroke });
        }
    }
    if (ctx.mode === 'briefing') {
        strokes.push(...ctx.briefingInk.map((stroke) => ({ stroke, session: true })));
    }
    if (ctx.streamer !== 'off') {
        strokes.push(...ctx.streamerInk.map((stroke) => ({ stroke, session: true })));
    }
    for (const { stroke, session } of strokes) {
        ink.push({
            type: 'Feature', id: stroke.id,
            properties: { id: stroke.id, color: stroke.color, width: stroke.width, op: stroke.opacity, session: session ? 1 : 0, sel: ctx.selection.has(stroke.id) ? 1 : 0 },
            geometry: { type: 'LineString', coordinates: stroke.points },
        });
    }

    const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
    return { zones: fc(zones), lines: fc(lines), points: fc(points), labels: fc(labels), ink: fc(ink) };
}

export function elementTitle(element: Element, teams: Map<string, Team>, typeLabel: (element: Element) => string): string {
    if (element.kind === 'text') {
        return element.text || typeLabel(element);
    }
    const team = element.teamId ? teams.get(element.teamId) : undefined;
    const name = element.label || team?.callsign || team?.name;
    return name ? `${name}` : typeLabel(element);
}

export function elementAnchor(element: Element): LngLat {
    switch (element.kind) {
        case 'marker':
        case 'text':
            return element.pos;
        case 'route':
            return element.points[0];
        case 'bearing':
            return element.start;
        case 'zone':
            return zoneLabelPos(element);
    }
}

export function elementPoints(element: Element): LngLat[] {
    switch (element.kind) {
        case 'marker':
        case 'text':
            return [element.pos];
        case 'route':
            return element.points;
        case 'bearing':
            return [element.start, element.end];
        case 'zone':
            return element.shape.type === 'circle' ? circlePolygon(element.shape.center, element.shape.radiusM, 16) : element.shape.points;
    }
}
