import type { Map as MlMap, MapMouseEvent, MapTouchEvent, PointLike } from 'maplibre-gl';
import { useUi, DRAW_COLORS, toast, type ToolId } from '../core/store/ui';
import { mutate, useProject } from '../core/store/project';
import { addElement, canEdit, activeLayerId, existingTeamId } from '../core/actions';
import { alignActive } from './align';
import { uid, nowIso } from '../core/model/factory';
import type { Element, LngLat, Project, Stroke } from '../core/model/schema';
import { insertVertex, isLocked, moveVertex, setRadius, simplify, translateElement } from '../core/model/geometry';
import { distanceM } from '../core/geo/geo';
import { t } from '../i18n';
import { HIT_LAYERS, INK_LAYER } from './planLayers';
import { mapRef } from './MapView';
import { visibleInPhase } from './planFeatures';

type Pt = { x: number; y: number };
type DragKind = 'element' | 'vertex' | 'mid' | 'radius';
type InkTarget = 'streamer' | 'briefing' | 'plan';

interface DragGesture {
    type: 'drag';
    kind: DragKind;
    id: string;
    index: number;
    start: LngLat;
    startPoint: Pt;
    original: Element;
    moved: boolean;
}

interface InkGesture {
    type: 'ink';
    target: InkTarget;
    screen: [number, number][];
    points: LngLat[];
}

interface EraseGesture {
    type: 'erase';
    target: InkTarget;
    session: Set<string>;
    persisted: Set<string>;
}

type Gesture = DragGesture | InkGesture | EraseGesture;

const CREATION: ToolId[] = ['marker', 'route', 'zone', 'text', 'bearing', 'measure'];
const MULTI_POINT: ToolId[] = ['route', 'zone', 'measure', 'bearing'];
/** Zone fills are never grabbed: a press inside an AO must pan the map. */
const DRAG_LAYERS = ['plan-markers', 'plan-text', 'plan-line-hit', 'plan-zone-line-hit'];

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
export function hitIds(map: MlMap, point: Pt, includeInk = true, radius = 10, layers = includeInk ? [...HIT_LAYERS, INK_LAYER] : HIT_LAYERS): string[] {
    const features = map.queryRenderedFeatures(box(point, radius), { layers: existingLayers(map, layers) });
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

/** Where ink drawn right now would go. `null`: drawing is not allowed. */
export function inkTarget(): InkTarget | null {
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

function currentPhaseId(project: Project): string | null {
    const ui = useUi.getState();
    return ui.mode === 'briefing' && project.phases.length > 0 ? project.phases[Math.min(ui.phaseIndex, project.phases.length - 1)].id : null;
}

function finishCreated(id: string, shiftKey: boolean) {
    if (!id) {
        return;
    }
    const project = useProject.getState().project;
    const ui = useUi.getState();
    const back = (project?.settings.returnToSelect ?? true) !== shiftKey;
    ui.set(back ? { tool: 'select', draft: null } : { draft: null });
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
    if (!canEdit()) {
        ui.set({ draft: null });
        return;
    }
    if (draft.tool === 'route' && points.length >= 2) {
        const style = ui.routeStyle;
        const id = addElement({
            kind: 'route', id: uid('el'), points, style, arrow: style !== 'boundary',
            teamId: existingTeamId(project, draft.teamId) ?? (style === 'boundary' ? undefined : existingTeamId(project, ui.activeTeamId)),
        }, t('tool.route'));
        finishCreated(id, shiftKey);
        return;
    }
    if (draft.tool === 'zone' && ui.zoneShape === 'polygon' && points.length >= 3) {
        const id = addElement({
            kind: 'zone', id: uid('el'), shape: { type: 'polygon', points }, category: ui.zoneCategory, fillOpacity: 0.18, label: t(`zone.${ui.zoneCategory}`),
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

function commitStroke(target: InkTarget, stroke: Stroke) {
    const ui = useUi.getState();
    const project = useProject.getState().project;
    if (!project || inkTarget() !== target) {
        return;
    }
    if (target === 'streamer') {
        ui.set({ streamerInk: [...ui.streamerInk, stroke] });
    } else if (target === 'briefing') {
        const phase = currentPhaseId(project);
        if (project.settings.keepBriefingInk && !useProject.getState().readOnly) {
            mutate(t('briefing.ink'), (draft) => {
                draft.drawings.push({ ...stroke, briefingOnly: true, phaseIds: phase ? [phase] : undefined });
            });
        } else {
            ui.set({ briefingInk: [...ui.briefingInk, stroke] });
        }
    } else {
        const layer = activeLayerId(project);
        if (!layer) {
            toast(t('common.locked'), { tone: 'warn' });
            return;
        }
        mutate(t('tool.draw'), (draft) => {
            draft.drawings.push({ ...stroke, layerId: layer });
        });
    }
}

/** Strokes within `radius` screen px that the gesture's target may erase (visible ones only). */
function erasableAt(map: MlMap, point: Pt, radius: number, target: InkTarget): { session: string[]; persisted: string[] } {
    const ui = useUi.getState();
    const project = useProject.getState().project;
    if (!project) {
        return { session: [], persisted: [] };
    }
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
    const layers = new Map(project.layers.map((layer) => [layer.id, layer]));
    const usable = (stroke: Stroke) => {
        const layer = layers.get(stroke.layerId ?? project.layers[0].id);
        return !layer || (layer.visible && !layer.locked);
    };
    if (target === 'streamer') {
        return { session: ui.streamerInk.filter(near).map((s) => s.id), persisted: [] };
    }
    if (target === 'briefing') {
        const phase = currentPhaseId(project);
        const keep = project.settings.keepBriefingInk && !useProject.getState().readOnly;
        return {
            session: ui.briefingInk.filter(near).map((s) => s.id),
            persisted: keep ? project.drawings.filter((s) => s.briefingOnly && visibleInPhase(s.phaseIds, phase) && usable(s) && near(s)).map((s) => s.id) : [],
        };
    }
    return { session: [], persisted: project.drawings.filter((s) => !s.briefingOnly && usable(s) && near(s)).map((s) => s.id) };
}

/** Only geometry is written back, so a peer's concurrent label or style edit survives a drag. */
function commitGeometry(next: Element) {
    mutate(t('common.edit'), (draft) => {
        const target = draft.elements.find((item) => item.id === next.id) as Record<string, unknown> | undefined;
        if (!target) {
            return;
        }
        switch (next.kind) {
            case 'marker':
            case 'text':
                target.pos = next.pos;
                break;
            case 'route':
                target.points = next.points;
                break;
            case 'bearing':
                target.start = next.start;
                target.end = next.end;
                break;
            case 'zone':
                target.shape = next.shape;
                if (next.labelPos) {
                    target.labelPos = next.labelPos;
                }
                break;
        }
    });
}

let abortActive: (() => boolean) | null = null;

/** Cancel any in-progress drag, stroke or erase without committing it. Returns true if one was active. */
export function abortGesture(): boolean {
    return abortActive?.() ?? false;
}

export function installInteraction(map: MlMap): () => void {
    let gesture: Gesture | null = null;
    let releasedAt = 0;
    let lastClick: { x: number; y: number; ids: string[]; index: number } | null = null;
    let spacePan = false;

    const canvas = map.getCanvasContainer();

    function applyToolState() {
        const { tool } = useUi.getState();
        const inking = (tool === 'draw' || tool === 'erase') && inkTarget() !== null;
        if ((inking && !spacePan) || gesture?.type === 'drag' && gesture.moved) {
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

    function abort(): boolean {
        if (!gesture) {
            return false;
        }
        const ui = useUi.getState();
        gesture = null;
        ui.set({ override: null, draft: ui.draft?.tool === 'draw' ? null : ui.draft });
        stopWindowWatch();
        applyToolState();
        return true;
    }
    abortActive = abort;

    const onWindowUp = () => endPress();
    const onWindowBlur = () => {
        abort();
    };
    function startWindowWatch() {
        window.addEventListener('pointerup', onWindowUp);
        window.addEventListener('blur', onWindowBlur);
    }
    function stopWindowWatch() {
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('blur', onWindowBlur);
    }

    function startPress(event: MapMouseEvent | MapTouchEvent): boolean {
        const ui = useUi.getState();
        const project = useProject.getState().project;
        if (!project || gesture || alignActive()) {
            return false;
        }
        const point = event.point;
        const p = ll(event);
        const target = inkTarget();
        if ((ui.tool === 'draw' || ui.tool === 'erase') && target && !spacePan) {
            if (ui.tool === 'draw') {
                gesture = { type: 'ink', target, screen: [[point.x, point.y]], points: [p] };
            } else {
                gesture = { type: 'erase', target, session: new Set(), persisted: new Set() };
                collectErase(gesture, point);
            }
            startWindowWatch();
            return true;
        }
        if (!canEdit() || ui.override) {
            return false;
        }
        const locked = lockedLayers(project);
        const defaultLayer = project.layers[0]?.id;
        const selectedWithHandles = ui.tool === 'select' && ui.selection.length === 1;
        if (selectedWithHandles) {
            const handle = hitHandle(map, point);
            const element = handle ? project.elements.find((e) => e.id === handle.id) : undefined;
            if (handle && element && !isLocked(element, locked, defaultLayer)) {
                const kind: DragKind = handle.role === 'mid' ? 'mid' : handle.role === 'radius' ? 'radius' : handle.role === 'move' ? 'element' : 'vertex';
                gesture = { type: 'drag', kind, id: element.id, index: handle.index, start: p, startPoint: point, original: element, moved: false };
                startWindowWatch();
                return true;
            }
        }
        const drafting = Boolean(ui.draft && ui.draft.points.length > 0);
        if (drafting || (ui.tool !== 'select' && !project.settings.directManipulation)) {
            return false;
        }
        const handleOwned = selectedWithHandles ? project.elements.find((e) => e.id === ui.selection[0]) : undefined;
        const ownsGeometry = handleOwned && (handleOwned.kind === 'route' || handleOwned.kind === 'zone' || handleOwned.kind === 'bearing');
        // A selected line/zone is moved by its handles only, so it never blocks grabbing a marker on top of it.
        const ids = hitIds(map, point, false, 8, DRAG_LAYERS).filter((id) => !(ownsGeometry && id === handleOwned.id));
        // Prefer the element the user selected (e.g. after tap-cycling to a lower one).
        const preferred = ids.find((id) => ui.selection.includes(id)) ?? ids[0];
        const element = project.elements.find((e) => e.id === preferred);
        if (!element || isLocked(element, locked, defaultLayer)) {
            return false;
        }
        if (ui.tool !== 'select' && element.kind !== 'marker' && element.kind !== 'text') {
            return false;
        }
        gesture = { type: 'drag', kind: 'element', id: element.id, index: 0, start: p, startPoint: point, original: element, moved: false };
        startWindowWatch();
        return true;
    }

    function collectErase(state: EraseGesture, point: Pt) {
        const hits = erasableAt(map, point, useUi.getState().eraserPx, state.target);
        hits.session.forEach((id) => state.session.add(id));
        hits.persisted.forEach((id) => state.persisted.add(id));
        if (hits.session.length > 0) {
            const ui = useUi.getState();
            ui.set({ briefingInk: ui.briefingInk.filter((s) => !state.session.has(s.id)), streamerInk: ui.streamerInk.filter((s) => !state.session.has(s.id)) });
        }
    }

    function moveTo(event: MapMouseEvent | MapTouchEvent) {
        const p = ll(event);
        const point = event.point;
        if (gesture?.type === 'ink') {
            const last = gesture.screen[gesture.screen.length - 1];
            if (Math.hypot(point.x - last[0], point.y - last[1]) >= 2) {
                gesture.screen.push([point.x, point.y]);
                gesture.points.push(p);
                useUi.getState().set({ draft: { tool: 'draw', points: [...gesture.points] } });
            }
            return;
        }
        if (gesture?.type === 'erase') {
            collectErase(gesture, point);
            return;
        }
        if (gesture?.type === 'drag') {
            if (!gesture.moved && Math.hypot(point.x - gesture.startPoint.x, point.y - gesture.startPoint.y) < 4) {
                return;
            }
            if (!gesture.moved) {
                gesture.moved = true;
                map.dragPan.disable();
            }
            let next: Element;
            if (gesture.kind === 'element') {
                next = translateElement(gesture.original, p[0] - gesture.start[0], p[1] - gesture.start[1]);
            } else if (gesture.kind === 'vertex') {
                next = moveVertex(gesture.original, gesture.index, p);
            } else if (gesture.kind === 'mid') {
                next = insertVertex(gesture.original, gesture.index, p);
            } else {
                next = setRadius(gesture.original, p);
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
        const state = gesture;
        if (!state) {
            return;
        }
        gesture = null;
        stopWindowWatch();
        releasedAt = performance.now();
        const ui = useUi.getState();
        if (state.type === 'ink') {
            ui.set({ draft: null });
            if (state.points.length >= 2) {
                const keep = simplify(state.screen, 1.2).slice(0, 4000);
                commitStroke(state.target, {
                    id: uid('ink'), points: keep.map((i) => state.points[i]), color: DRAW_COLORS[ui.drawColor] ?? DRAW_COLORS[0], width: ui.drawWidth, opacity: 0.95, createdAt: nowIso(),
                });
            }
        } else if (state.type === 'erase') {
            const ids = new Set(state.persisted);
            if (ids.size > 0 && inkTarget() === state.target) {
                mutate(t('tool.erase'), (draft) => {
                    draft.drawings = draft.drawings.filter((stroke) => !ids.has(stroke.id));
                });
            }
        } else {
            const next = ui.override;
            ui.set({ override: null });
            if (state.moved && next && canEdit()) {
                commitGeometry(next);
                if (!ui.selection.includes(state.id)) {
                    ui.select([state.id]);
                }
            } else if (!state.moved) {
                releasedAt = 0;
            }
        }
        applyToolState();
    }

    const onDown = (event: MapMouseEvent) => {
        if (event.originalEvent.button !== 0) {
            return;
        }
        releasedAt = 0;
        if (startPress(event)) {
            event.preventDefault();
        }
    };
    const onTouchStart = (event: MapTouchEvent) => {
        releasedAt = 0;
        if (event.points.length > 1) {
            abort();
            return;
        }
        if (startPress(event)) {
            event.preventDefault();
        }
    };
    const onMove = (event: MapMouseEvent) => {
        if (gesture && (event.originalEvent as MouseEvent).buttons === 0) {
            endPress();
            return;
        }
        moveTo(event);
    };
    const onTouchMove = (event: MapTouchEvent) => {
        if (event.points.length === 1) {
            moveTo(event);
        }
    };
    const onUp = () => endPress();
    const onTouchCancel = () => abort();

    const onClick = (event: MapMouseEvent) => {
        if (releasedAt && performance.now() - releasedAt < 350) {
            releasedAt = 0;
            return;
        }
        const ui = useUi.getState();
        const project = useProject.getState().project;
        if (!project || alignActive()) {
            return;
        }
        const shiftKey = (event.originalEvent as MouseEvent).shiftKey;
        const p = ll(event);
        const tool = ui.tool;
        if (tool === 'draw' || tool === 'erase') {
            return;
        }
        if (tool !== 'select' && tool !== 'measure' && !canEdit()) {
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
        const target = event.target as HTMLElement | null;
        // Space belongs to focused controls (buttons, tabs, switches, dialogs) and text fields.
        if (event.code !== 'Space' || target?.closest?.('input, textarea, select, [contenteditable], button, a[href], summary, [role="button"], [role="menuitem"], [role="switch"], [role="tab"], [role="option"], dialog')) {
            return;
        }
        // Keep space from activating a focused button while it is used for panning.
        event.preventDefault();
        const down = event.type === 'keydown';
        if (down !== spacePan) {
            spacePan = down;
            applyToolState();
        }
    };
    const onBlur = () => {
        if (spacePan) {
            spacePan = false;
            applyToolState();
        }
    };

    map.on('mousedown', onDown);
    map.on('touchstart', onTouchStart);
    map.on('mousemove', onMove);
    map.on('touchmove', onTouchMove);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    map.on('touchcancel', onTouchCancel);
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    const unsubUi = useUi.subscribe((state, prev) => {
        if (state.tool !== prev.tool || state.mode !== prev.mode || state.streamer !== prev.streamer) {
            // A gesture never survives a change of what it is allowed to do.
            abort();
            applyToolState();
            seedRoute(state.tool, prev.tool);
        }
    });
    const unsubProject = useProject.subscribe((state, prev) => {
        if (state.readOnly !== prev.readOnly) {
            abort();
            applyToolState();
        }
    });
    applyToolState();

    return () => {
        abort();
        if (abortActive === abort) {
            abortActive = null;
        }
        map.off('mousedown', onDown);
        map.off('touchstart', onTouchStart);
        map.off('mousemove', onMove);
        map.off('touchmove', onTouchMove);
        map.off('mouseup', onUp);
        map.off('touchend', onUp);
        map.off('touchcancel', onTouchCancel);
        map.off('click', onClick);
        map.off('dblclick', onDblClick);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onBlur);
        unsubUi();
        unsubProject();
    };
}

/** Arming Route with a friendly unit selected seeds the first waypoint at that unit. */
function seedRoute(tool: ToolId, prevTool: ToolId) {
    if (tool !== 'route' || prevTool === 'route' || !canEdit()) {
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
    if (abortGesture()) {
        return true;
    }
    if (ui.override) {
        ui.set({ override: null });
        return true;
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
