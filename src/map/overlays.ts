import type { Map as MlMap } from 'maplibre-gl';
import { useUi } from '../core/store/ui';
import { useProject } from '../core/store/project';
import { usePrefs } from '../core/store/prefs';
import { canEdit } from '../core/actions';
import { bearingDeg, circlePolygon, distanceM, formatArea, formatBearing, formatDistance, formatMils, midpoint, pathLengthM, polygonAreaM2 } from '../core/geo/geo';
import { radiusHandle } from '../core/model/geometry';
import type { LngLat } from '../core/model/schema';
import { EMPTY_FC } from './basemap';
import { setSourceData } from './planLayers';
import { DRAW_COLORS } from '../core/store/ui';
import { isElementVisible } from './planFeatures';
import { renderAlign } from './align';

type F = GeoJSON.Feature;
const point = (coordinates: LngLat, properties: Record<string, unknown> = {}): F => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
const line = (coordinates: LngLat[], properties: Record<string, unknown> = {}): F => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } });

function bearingText(a: LngLat, b: LngLat): string {
    const unit = usePrefs.getState().bearingUnit;
    const deg = bearingDeg(a, b);
    return `${unit === 'mil' ? formatMils(deg) : formatBearing(deg)} · ${formatDistance(distanceM(a, b))}`;
}

/** Drafts (in-progress geometry), measurements and freehand ink preview. */
export function renderDraft(map: MlMap) {
    const ui = useUi.getState();
    const features: F[] = [];
    const draft = ui.draft;
    // Under Streamer Safe only ink previews show; planning drafts keep their state but stay off-stream.
    const hidePlanning = ui.streamer !== 'off';
    if (draft && draft.tool === 'draw') {
        features.push(line(draft.points, { color: DRAW_COLORS[ui.drawColor], width: ui.drawWidth }));
    } else if (draft && !hidePlanning) {
        const pts = draft.hover ? [...draft.points, draft.hover] : draft.points;
        if (draft.tool === 'zone' && ui.zoneShape === 'circle' && draft.points.length === 1 && draft.hover) {
            const radius = distanceM(draft.points[0], draft.hover);
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circlePolygon(draft.points[0], radius, 64)] } });
            features.push(line([draft.points[0], draft.hover]));
            features.push(point(draft.hover, { text: `r = ${formatDistance(radius)}` }));
        } else if (pts.length >= 2) {
            if (draft.tool === 'zone' && pts.length >= 3) {
                features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
                features.push(point(pts[pts.length - 1], { text: formatArea(polygonAreaM2(pts)) }));
            }
            features.push(line(pts));
            if (draft.tool === 'bearing' || (draft.tool !== 'zone' && pts.length === 2)) {
                features.push(point(midpoint(pts[0], pts[1]), { text: bearingText(pts[0], pts[1]) }));
            } else if (draft.tool !== 'zone') {
                features.push(point(pts[pts.length - 1], { text: `Σ ${formatDistance(pathLengthM(pts))}` }));
            }
        }
        draft.points.forEach((p, i) => features.push(point(p, { first: i === 0 ? 1 : 0 })));
    }
    if (ui.measure && ui.measure.length >= 2 && !hidePlanning) {
        const pts = ui.measure;
        features.push(line(pts));
        pts.forEach((p, i) => features.push(point(p, { first: i === 0 ? 1 : 0 })));
        features.push(point(pts[pts.length - 1], { text: `Σ ${formatDistance(pathLengthM(pts))}` }));
    }
    setSourceData(map, 'draft', features.length ? { type: 'FeatureCollection', features } : EMPTY_FC);
}

/** Vertex, midpoint and radius handles for the single selected editable element. */
export function renderEdit(map: MlMap) {
    const ui = useUi.getState();
    if (ui.imageEditId) {
        renderAlign(map);
        return;
    }
    const project = useProject.getState().project;
    const features: F[] = [];
    if (project && ui.tool === 'select' && ui.selection.length === 1 && canEdit() && ui.streamer === 'off') {
        const base = project.elements.find((e) => e.id === ui.selection[0]);
        const element = ui.override && ui.override.id === base?.id ? ui.override : base;
        const layerLocked = project.layers.find((l) => l.id === (element?.layerId ?? project.layers[0]?.id))?.locked;
        const visible = element ? isElementVisible(element, project, { mode: ui.mode, phaseId: null, streamer: ui.streamer, selection: new Set(), bearingUnit: 'deg', briefingInk: [], streamerInk: [] }) : false;
        if (element && visible && !element.locked && !layerLocked) {
            const id = element.id;
            const addVertices = (pts: LngLat[], closed: boolean) => {
                pts.forEach((p, index) => features.push(point(p, { id, role: 'vertex', index })));
                if (pts.length <= 120) {
                    const count = closed ? pts.length : pts.length - 1;
                    for (let index = 0; index < count; index++) {
                        features.push(point(midpoint(pts[index], pts[(index + 1) % pts.length]), { id, role: 'mid', index }));
                    }
                }
            };
            if (element.kind === 'route') {
                addVertices(element.points, false);
            } else if (element.kind === 'bearing') {
                features.push(point(element.start, { id, role: 'vertex', index: 0 }), point(element.end, { id, role: 'vertex', index: 1 }));
            } else if (element.kind === 'zone' && element.shape.type === 'polygon') {
                addVertices(element.shape.points, true);
            } else if (element.kind === 'zone' && element.shape.type === 'circle') {
                const edge = radiusHandle(element);
                features.push(point(element.shape.center, { id, role: 'move', index: 0 }));
                if (edge) {
                    features.push(point(edge, { id, role: 'radius', index: 0 }), line([element.shape.center, edge]));
                }
            }
        }
    }
    setSourceData(map, 'edit', features.length ? { type: 'FeatureCollection', features } : EMPTY_FC);
}
