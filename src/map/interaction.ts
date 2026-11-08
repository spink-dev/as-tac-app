import type { Map as MlMap, MapMouseEvent, MapTouchEvent, PointLike } from 'maplibre-gl';
import { useUi, DRAW_COLORS, type ToolId } from '../core/store/ui';
import { mutate, useProject } from '../core/store/project';
import { addElement, canEdit, replaceElement, activeLayerId } from '../core/actions';
import { uid, nowIso } from '../core/model/factory';
import type { Element, LngLat, Project, Stroke } from '../core/model/schema';
import { insertVertex, isLocked, moveVertex, setRadius, simplify, translateElement } from '../core/model/geometry';
import { distanceM } from '../core/geo/geo';
import { t } from '../i18n';
import { HIT_LAYERS, INK_LAYER } from './planLayers';
import { mapRef } from './MapView';

type Pt = { x: number; y: number };
type DragKind = 'element' | 'vertex' | 'mid' | 'radius';

interface DragState {
    kind: DragKind;
    id: string;
    index: number;
    start: LngLat;
    startPoint: Pt;
    original: Element;
    moved: boolean;
}

const CREATION: ToolId[] = ['marker', 'route', 'zone', 'text', 'bearing', 'measure'];
const MULTI_POINT: ToolId[] = ['route', 'zone', 'measure', 'bearing'];

function ll(event: { lngLat: { lng: number; lat: number } }): LngLat {
    return [event.lngLat.lng, event.lngLat.lat];
}

function lockedLayers(project: Project): Set<string> {
    return new Set(project.layers.filter((layer) => layer.locked).map((layer) => layer.id));
}

function existingLayers(map: MlMap, ids: string[]): string[] {
    return ids.filter((id) => map.getLayer(id));
}

function box(point: Pt, r: number): [PointLike, PointLike] {
    return [[point.x - r, point.y - r], [point.x + r, point.y + r]];
}

/** Plan element / stroke ids under the pointer, topmost first. */
export function hitIds(map: MlMap, point: Pt, includeInk = true, radius = 10): string[] {
    const layers = existingLayers(map, includeInk ? [...HIT_LAYERS, INK_LAYER] : HIT_LAYERS);
    const features = map.queryRenderedFeatures(box(point, radius), { layers });
    const ids: string[] = [];
    for (const feature of features) {
        const id = feature.properties?.id as string | undefined;
        if (id && !ids.includes(id) && feature.properties?.session !== 1) {
            ids.push(id);
        }
    }
    return ids;
}

function hitHandle(map: MlMap, point: Pt): { role: string; index: number; id: string } | null {
    if (!map.getLayer('edit-handles')) {
        return null;
    }
    const feature = map.queryRenderedFeatures(box(point, 14), { layers: ['edit-handles'] })[0];
    if (!feature?.properties) {
        return null;
    }
    return { role: String(feature.properties.role), index: Number(feature.properties.index ?? 0), id: String(feature.properties.id) };
}

function inkTarget(): 'streamer' | 'briefing' | 'plan' | null {
    const { streamer, mode } = useUi.getState();
    if (streamer !== 'off') {
        return 'streamer';
    }
    if (mode === 'briefing') {
        return 'briefing';
    }
    if (mode === 'plan' && !useProject.getState().readOnly) {
        return 'plan';
    }
    return null;
}

function finishCreated(id: string, shiftKey: boolean) {
    const project = useProject.getState().project;
    const ui = useUi.getState();
    const back = (project?.settings.returnToSelect ?? true) !== shiftKey;
    if (back) {
        ui.set({ tool: 'select', draft: null });
    } else {
        ui.set({ draft: null });
    }
    ui.select([id]);
}

export function finishDraft(shiftKey = false) {
    const ui = useUi.getState();
    const draft = ui.draft;
    const project = useProject.getState().project;
    if (!draft || !project) {
        return;
    }
    const points = draft.points;
    if (draft.tool === 'measure') {
        ui.set({ measure: points, draft: null });
        return;
    }
    if (draft.tool === 'route' && points.length >= 2) {
        const style = ui.routeStyle;
        const id = addElement({
            kind: 'route', id: uid('el'), points, style, arrow: style !== 'boundary',
            teamId: draft.teamId ?? (style === 'boundary' ? undefined : ui.activeTeamId ?? undefined),
        }, t('tool.route'));
        finishCreated(id, shiftKey);
        return;
    }
    if (draft.tool === 'zone' && ui.zoneShape === 'polygon' && points.length >= 3) {
        const id = addElement({
            kind: 'zone', id: uid('el'), shape: { type: 'polygon', points }, category: ui.zoneCategory, fillOpacity: 0.18,
            label: t(`zone.${ui.zoneCategory}`),
        }, t('tool.zone'));
        finishCreated(id, shiftKey);
        return;
    }
    ui.set({ draft: null });
}

function addDraftPoint(map: MlMap, p: LngLat, point: Pt, shiftKey: boolean) {
    const ui = useUi.getState();
    const tool = ui.tool;
    const draft = ui.draft && ui.draft.tool === tool ? ui.draft : { tool, points: [] as LngLat[] };
    if (tool === 'zone' && ui.zoneShape === 'circle') {
        if (draft.points.length === 0) {
            ui.set({ draft: { ...draft, points: [p] } });
            return;
        }
        const center = draft.points[0];
        const id = addElement({
            kind: 'zone', id: uid('el'), shape: { type: 'circle', center, radiusM: Math.max(1, distanceM(center, p)) },
            category: ui.zoneCategory, fillOpacity: 0.18, label: t(`zone.${ui.zoneCategory}`),
        }, t('tool.zone'));
        finishCreated(id, shiftKey);
        return;
    }
    if (tool === 'bearing') {
        if (draft.points.length === 0) {
            ui.set({ draft: { ...draft, points: [p] } });
            return;
        }
        const id = addElement({ kind: 'bearing', id: uid('el'), start: draft.points[0], end: p }, t('tool.bearing'));
        finishCreated(id, shiftKey);
        return;
    }
    if (draft.points.length > 0) {
        const first = map.project(draft.points[0]);
        const last = map.project(draft.points[draft.points.length - 1]);
        if (tool === 'zone' && draft.points.length >= 3 && Math.hypot(first.x - point.x, first.y - point.y) < 16) {
            finishDraft(shiftKey);
            return;
        }
        if (draft.points.length >= 2 && Math.hypot(last.x - point.x, last.y - point.y) < 12) {
            finishDraft(shiftKey);
            return;
        }
    }
    if (tool === 'measure' && ui.measure && !ui.draft) {
        ui.set({ measure: null });
    }
    ui.set({ draft: { ...draft, points: [...draft.points, p] } });
}

function createPointElement(p: LngLat, shiftKey: boolean) {
    const ui = useUi.getState();
    const project = useProject.getState().project;
    if (!project) {
        return;
    }
    if (ui.tool === 'marker') {
        const type = ui.markerType;
        const team = (type === 'unit' || type === 'hq' || type === 'enemy') && ui.activeTeamId ? project.teams.find((x) => x.id === ui.activeTeamId) : undefined;
        const id = addElement({ kind: 'marker', id: uid('el'), pos: p, type, teamId: team?.id, label: type === 'unit' && team ? team.callsign ?? team.name : undefined }, t(`marker.${type}`));
        finishCreated(id, shiftKey);
    } else if (ui.tool === 'text') {
        const id = addElement({ kind: 'text', id: uid('el'), pos: p, text: t('tool.text'), size: 14 }, t('tool.text'));
        finishCreated(id, false);
    }
}

function strokeFrom(map: MlMap, screen: [number, number][], points: LngLat[], extra: Partial<Stroke> = {}): Stroke | null {
    if (points.length < 2) {
        return null;
    }
    const keep = simplify(screen, 1.2).slice(0, 4000);
    const ui = useUi.getState();
    void map;
    return {
        id: uid('ink'), points: keep.map((i) => points[i]), color: DRAW_COLORS[ui.drawColor] ?? DRAW_COLORS[0], width: ui.drawWidth, opacity: 0.95,
        createdAt: nowIso(), ...extra,
    };
}

function commitStroke(stroke: Stroke) {
    const target = inkTarget();
    const ui = useUi.getState();
    const project = useProject.getState().project;
    if (!target || !project) {
        return;
    }
    if (target === 'streamer') {
        ui.set({ streamerInk: [...ui.streamerInk, stroke] });
    } else if (target === 'briefing') {
        const phase = project.phases[Math.min(ui.phaseIndex, project.phases.length - 1)];
        if (project.settings.keepBriefingInk && !useProject.getState().readOnly) {
            mutate(t('briefing.ink'), (draft) => {
                draft.drawings.push({ ...stroke, briefingOnly: true, phaseIds: phase ? [phase.id] : undefined });
            });
        } else {
            ui.set({ briefingInk: [...ui.briefingInk, stroke] });
        }
    } else {
        mutate(t('tool.draw'), (draft) => {
            draft.drawings.push({ ...stroke, layerId: activeLayerId(project) });
        });
    }
}

/** Strokes within `radius` screen px of the pointer that the current mode may erase. */
function erasableAt(map: MlMap, point: Pt, radius: number): { session: string[]; persisted: string[] } {
    const target = inkTarget();
    const ui = useUi.getState();
    const project = useProject.getState().project;
    const near = (stroke: Stroke) => {
        for (let i = 1; i < stroke.points.length; i++) {
            const a = map.project(stroke.points[i - 1]);
            const b = map.project(stroke.points[i]);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const lengthSq = dx * dx + dy * dy || 1;
            const tt = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
            if (Math.hypot(a.x + tt * dx - point.x, a.y + tt * dy - point.y) <= radius + stroke.width / 2) {
                return true;
            }
        }
        return false;
    };
    if (!project || !target) {
        return { session: [], persisted: [] };
    }
    if (target === 'streamer') {
        return { session: ui.streamerInk.filter(near).map((s) => s.id), persisted: [] };
    }
    if (target === 'briefing') {
        return { session: ui.briefingInk.filter(near).map((s) => s.id), persisted: project.drawings.filter((s) => s.briefingOnly && near(s)).map((s) => s.id) };
    }
    return { session: [], persisted: project.drawings.filter((s) => !s.briefingOnly && near(s)).map((s) => s.id) };
}

export function installInteraction(map: MlMap): () => void {
    let drag: DragState | null = null;
    let ink: { screen: [number, number][]; points: LngLat[] } | null = null;
    let erase: { session: Set<string>; persisted: Set<string> } | null = null;
    let suppressClick = false;
    let lastClick: { x: number; y: number; ids: string[]; index: number } | null = null;
    let spacePan = false;

    const canvas = map.getCanvasContainer();

    function applyToolState() {
        const { tool, mode, streamer } = useUi.getState();
        const inking = (tool === 'draw' || tool === 'erase') && (mode !== 'field' || streamer !== 'off');
        if (inking && !spacePan) {
            map.dragPan.disable();
        } else {
            map.dragPan.enable();
        }
        if (MULTI_POINT.includes(tool)) {
            map.doubleClickZoom.disable();
        } else {
            map.doubleClickZoom.enable();
        }
        canvas.style.cursor = CREATION.includes(tool) ? 'crosshair' : inking ? 'cell' : '';
    }

    function startPress(event: MapMouseEvent | MapTouchEvent): boolean {
        const ui = useUi.getState();
        const project = useProject.getState().project;
        if (!project) {
            return false;
        }
        const point = event.point;
        const p = ll(event);
        if ((ui.tool === 'draw' || ui.tool === 'erase') && inkTarget() && !spacePan) {
            if (ui.tool === 'draw') {
                ink = { screen: [[point.x, point.y]], points: [p] };
            } else {
                erase = { session: new Set(), persisted: new Set() };
                collectErase(point);
            }
            return true;
        }
        if (!canEdit() || ui.override) {
            return false;
        }
        const locked = lockedLayers(project);
        const defaultLayer = project.layers[0]?.id;
        if (ui.tool === 'select' && ui.selection.length === 1) {
            const handle = hitHandle(map, point);
            const element = handle ? project.elements.find((e) => e.id === handle.id) : undefined;
            if (handle && element && !isLocked(element, locked, defaultLayer)) {
                const kind: DragKind = handle.role === 'mid' ? 'mid' : handle.role === 'radius' ? 'radius' : handle.role === 'move' ? 'element' : 'vertex';
                drag = { kind, id: element.id, index: handle.index, start: p, startPoint: point, original: element, moved: false };
                return true;
            }
        }
        const drafting = Boolean(ui.draft && ui.draft.points.length > 0);
        const direct = project.settings.directManipulation;
        if (drafting || (ui.tool !== 'select' && !direct)) {
            return false;
        }
        const ids = hitIds(map, point, false, 8);
        const element = ids.map((id) => project.elements.find((e) => e.id === id)).find((e): e is Element => Boolean(e));
        if (!element || isLocked(element, locked, defaultLayer)) {
            return false;
        }
        if (ui.tool !== 'select' && element.kind !== 'marker' && element.kind !== 'text') {
            return false;
        }
        drag = { kind: 'element', id: element.id, index: 0, start: p, startPoint: point, original: element, moved: false };
        return true;
    }

    function collectErase(point: Pt) {
        if (!erase) {
            return;
        }
        const hits = erasableAt(map, point, useUi.getState().eraserPx);
        hits.session.forEach((id) => erase?.session.add(id));
        hits.persisted.forEach((id) => erase?.persisted.add(id));
        const ui = useUi.getState();
        if (hits.session.length > 0) {
            ui.set({ briefingInk: ui.briefingInk.filter((s) => !erase?.session.has(s.id)), streamerInk: ui.streamerInk.filter((s) => !erase?.session.has(s.id)) });
        }
    }

    function moveTo(event: MapMouseEvent | MapTouchEvent) {
        const p = ll(event);
        const point = event.point;
        if (ink) {
            const last = ink.screen[ink.screen.length - 1];
            if (Math.hypot(point.x - last[0], point.y - last[1]) >= 2) {
                ink.screen.push([point.x, point.y]);
                ink.points.push(p);
                const ui = useUi.getState();
                ui.set({ draft: { tool: 'draw', points: [...ink.points] } });
            }
            return;
        }
        if (erase) {
            collectErase(point);
            return;
        }
        if (drag) {
            if (!drag.moved && Math.hypot(point.x - drag.startPoint.x, point.y - drag.startPoint.y) < 4) {
                return;
            }
            if (!drag.moved) {
                drag.moved = true;
                map.dragPan.disable();
            }
            let next: Element;
            if (drag.kind === 'element') {
                next = translateElement(drag.original, p[0] - drag.start[0], p[1] - drag.start[1]);
            } else if (drag.kind === 'vertex') {
                next = moveVertex(drag.original, drag.index, p);
            } else if (drag.kind === 'mid') {
                next = insertVertex(drag.original, drag.index, p);
            } else {
                next = setRadius(drag.original, p);
            }
            useUi.getState().set({ override: next });
            return;
        }
        const ui = useUi.getState();
        if (ui.draft && ui.draft.tool !== 'draw') {
            ui.set({ draft: { ...ui.draft, hover: p } });
        }
    }

    function endPress() {
        if (ink) {
            const stroke = strokeFrom(map, ink.screen, ink.points);
            ink = null;
            useUi.getState().set({ draft: null });
            if (stroke) {
                commitStroke(stroke);
            }
            suppressClick = true;
            return;
        }
        if (erase) {
            const persisted = [...erase.persisted];
            erase = null;
            suppressClick = true;
            if (persisted.length > 0) {
                const set = new Set(persisted);
                mutate(t('tool.erase'), (draft) => {
                    draft.drawings = draft.drawings.filter((stroke) => !set.has(stroke.id));
                });
            }
            return;
        }
        if (drag) {
            const state = drag;
            drag = null;
            applyToolState();
            const next = useUi.getState().override;
            useUi.getState().set({ override: null });
            if (state.moved && next) {
                suppressClick = true;
                replaceElement(next, t('common.edit'));
                if (useUi.getState().tool === 'select' || !useUi.getState().selection.includes(state.id)) {
                    useUi.getState().select([state.id]);
                }
            }
        }
    }

    const onDown = (event: MapMouseEvent) => {
        if (event.originalEvent.button !== 0) {
            return;
        }
        if (startPress(event)) {
            event.preventDefault();
        }
    };
    const onTouchStart = (event: MapTouchEvent) => {
        if (event.points.length > 1) {
            ink = null;
            erase = null;
            if (drag) {
                drag = null;
                useUi.getState().set({ override: null, draft: useUi.getState().draft?.tool === 'draw' ? null : useUi.getState().draft });
            }
            map.dragPan.enable();
            return;
        }
        if (startPress(event)) {
            event.preventDefault();
        }
    };
    const onMove = (event: MapMouseEvent) => moveTo(event);
    const onTouchMove = (event: MapTouchEvent) => {
        if (event.points.length === 1) {
            moveTo(event);
        }
    };
    const onUp = () => endPress();

    const onClick = (event: MapMouseEvent) => {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        const ui = useUi.getState();
        const project = useProject.getState().project;
        if (!project) {
            return;
        }
        const shiftKey = (event.originalEvent as MouseEvent).shiftKey;
        const p = ll(event);
        const tool = ui.tool;
        if (tool === 'draw' || tool === 'erase') {
            return;
        }
        const editable = canEdit();
        if (tool !== 'select' && tool !== 'measure' && !editable) {
            return;
        }
        if (tool === 'select' || ((tool === 'marker' || tool === 'text') && project.settings.directManipulation && !ui.draft)) {
            const ids = hitIds(map, event.point);
            const pointHits = tool === 'select' ? ids : ids.filter((id) => {
                const element = project.elements.find((e) => e.id === id);
                return element?.kind === 'marker' || element?.kind === 'text';
            });
            if (pointHits.length > 0) {
                let index = 0;
                if (lastClick && Math.hypot(lastClick.x - event.point.x, lastClick.y - event.point.y) < 6 && lastClick.ids.join() === pointHits.join()) {
                    index = (lastClick.index + 1) % pointHits.length;
                }
                lastClick = { x: event.point.x, y: event.point.y, ids: pointHits, index };
                ui.select([pointHits[index]], shiftKey && tool === 'select');
                return;
            }
            if (tool === 'select') {
                lastClick = null;
                if (ui.selection.length > 0) {
                    ui.set({ selection: [] });
                }
                return;
            }
        }
        if (tool === 'marker' || tool === 'text') {
            createPointElement(p, shiftKey);
            return;
        }
        if (MULTI_POINT.includes(tool)) {
            addDraftPoint(map, p, event.point, shiftKey);
        }
    };

    const onDblClick = (event: MapMouseEvent) => {
        const ui = useUi.getState();
        if (ui.draft && MULTI_POINT.includes(ui.tool)) {
            event.preventDefault();
            finishDraft((event.originalEvent as MouseEvent).shiftKey);
        }
    };

    const onKey = (event: KeyboardEvent) => {
        if (event.code !== 'Space' || (event.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) {
            return;
        }
        const down = event.type === 'keydown';
        if (down !== spacePan) {
            spacePan = down;
            applyToolState();
        }
    };

    map.on('mousedown', onDown);
    map.on('touchstart', onTouchStart);
    map.on('mousemove', onMove);
    map.on('touchmove', onTouchMove);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    map.on('touchcancel', onUp);
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const unsub = useUi.subscribe((state, prev) => {
        if (state.tool !== prev.tool || state.mode !== prev.mode || state.streamer !== prev.streamer) {
            applyToolState();
            seedRoute(state.tool, prev.tool);
        }
    });
    applyToolState();

    return () => {
        map.off('mousedown', onDown);
        map.off('touchstart', onTouchStart);
        map.off('mousemove', onMove);
        map.off('touchmove', onTouchMove);
        map.off('mouseup', onUp);
        map.off('touchend', onUp);
        map.off('touchcancel', onUp);
        map.off('click', onClick);
        map.off('dblclick', onDblClick);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        unsub();
    };
}

/** Arming Route with a friendly unit selected seeds the first waypoint at that unit. */
function seedRoute(tool: ToolId, prevTool: ToolId) {
    if (tool !== 'route' || prevTool === 'route') {
        return;
    }
    const ui = useUi.getState();
    const project = useProject.getState().project;
    if (!project || ui.selection.length !== 1) {
        return;
    }
    const element = project.elements.find((e) => e.id === ui.selection[0]);
    if (element?.kind === 'marker' && (element.type === 'unit' || element.type === 'hq') && element.teamId) {
        ui.set({ draft: { tool: 'route', points: [element.pos], teamId: element.teamId } });
    }
}

export function removeLastDraftPoint() {
    const ui = useUi.getState();
    if (!ui.draft) {
        return;
    }
    const points = ui.draft.points.slice(0, -1);
    ui.set({ draft: points.length > 0 ? { ...ui.draft, points } : null });
}

export function cancelDraft() {
    const ui = useUi.getState();
    if (ui.override) {
        ui.set({ override: null });
    }
    if (ui.draft) {
        ui.set({ draft: null });
        return true;
    }
    if (ui.measure) {
        ui.set({ measure: null });
        return true;
    }
    return false;
}

export function mapCenter(): LngLat | null {
    const center = mapRef.current?.getCenter();
    return center ? [center.lng, center.lat] : null;
}

export function editingElement(project: Project, ids: string[]): Element | null {
    if (ids.length !== 1) {
        return null;
    }
    return project.elements.find((e) => e.id === ids[0]) ?? null;
}

