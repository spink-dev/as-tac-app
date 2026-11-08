import type { Draft } from 'immer';
import { mutate, useProject } from './store/project';
import { toast, useUi, type ToolId } from './store/ui';
import { APPEARANCE_ORDER, usePrefs } from './store/prefs';
import { uid, nowIso } from './model/factory';
import type { Element, LngLat, MarkerType, Project, RouteStyle, ZoneCategory } from './model/schema';
import { isLocked, translateElement } from './model/geometry';
import { t } from '../i18n';
import { elementAnchor } from '../map/planFeatures';

export const MARKER_TYPES: MarkerType[] = ['unit', 'enemy', 'objective', 'medic', 'respawn', 'danger', 'hq', 'custom', 'poi', 'flag'];
export const ROUTE_STYLES: RouteStyle[] = ['planned', 'actual', 'alternative', 'boundary'];
export const ZONE_CATEGORIES: ZoneCategory[] = ['ao', 'nogo', 'respawn', 'objective', 'danger', 'safe', 'civil', 'custom'];

export function canEdit(): boolean {
    const { readOnly, project } = useProject.getState();
    const { mode } = useUi.getState();
    return Boolean(project) && !readOnly && mode === 'plan';
}

/** Drawing layer for new objects; `null` when every layer is locked. */
export function activeLayerId(project: Project): string | null {
    const wanted = useUi.getState().activeLayerId;
    const unlocked = project.layers.filter((layer) => !layer.locked);
    if (wanted && unlocked.some((layer) => layer.id === wanted)) {
        return wanted;
    }
    const visible = unlocked.filter((layer) => layer.visible);
    return (visible[visible.length - 1] ?? unlocked[unlocked.length - 1])?.id ?? null;
}

function layerLocks(project: Project): Set<string> {
    return new Set(project.layers.filter((layer) => layer.locked).map((layer) => layer.id));
}

export function elementLocked(project: Project, element: Element): boolean {
    return isLocked(element, layerLocks(project), project.layers[0]?.id);
}

export function typeLabel(element: Element): string {
    switch (element.kind) {
        case 'marker':
            return t(`marker.${element.type}`);
        case 'route':
            return `${t('tool.route')} · ${t(`route.${element.style}`)}`;
        case 'zone':
            return t(`zone.${element.category}`);
        case 'text':
            return t('tool.text');
        case 'bearing':
            return t('tool.bearing');
    }
}

export function addElement(element: Element, label: string): string {
    const project = useProject.getState().project;
    if (!project || !canEdit()) {
        return '';
    }
    const layerId = element.layerId ?? activeLayerId(project);
    if (!layerId) {
        toast(t('common.locked'), { tone: 'warn' });
        return '';
    }
    const withLayer = { ...element, layerId };
    mutate(label, (draft) => {
        draft.elements.push(withLayer as Draft<Element>);
    });
    return withLayer.id;
}

export function replaceElement(element: Element, label: string, key?: string) {
    mutate(label, (draft) => {
        const index = draft.elements.findIndex((item) => item.id === element.id);
        if (index >= 0) {
            draft.elements[index] = element as Draft<Element>;
        }
    }, key ? { key } : undefined);
}

export function patchElement(id: string, patch: Partial<Element>, label = t('common.edit'), key?: string) {
    mutate(label, (draft) => {
        const element = draft.elements.find((item) => item.id === id);
        if (element) {
            Object.assign(element, patch);
            for (const [k, v] of Object.entries(patch)) {
                if (v === undefined) {
                    delete (element as Record<string, unknown>)[k];
                }
            }
        }
    }, { key: key ?? `patch:${id}:${Object.keys(patch).join(',')}` });
}

export function deleteSelection() {
    const { selection } = useUi.getState();
    const project = useProject.getState().project;
    if (!project || selection.length === 0 || !canEdit()) {
        return;
    }
    const ids = new Set(selection);
    const locks = layerLocks(project);
    const removable = project.elements.filter((element) => ids.has(element.id) && !elementLocked(project, element));
    const strokes = project.drawings.filter((stroke) => ids.has(stroke.id) && !locks.has(stroke.layerId ?? project.layers[0]?.id));
    if (removable.length + strokes.length === 0) {
        toast(t('common.locked'), { tone: 'warn' });
        return;
    }
    const removed = new Set([...removable.map((e) => e.id), ...strokes.map((s) => s.id)]);
    mutate(t('common.delete'), (draft) => {
        draft.elements = draft.elements.filter((element) => !removed.has(element.id));
        draft.drawings = draft.drawings.filter((stroke) => !removed.has(stroke.id));
    });
    useUi.getState().set({ selection: [] });
    const name = removable.length === 1 ? (removable[0].label || typeLabel(removable[0])) : '';
    toastUndoable(removed.size === 1 && name ? t('inspector.deleted', { name }) : t('inspector.deletedMany', { n: removed.size }));
}

/**
 * Toast whose Undo reverts exactly the step just made: only while it is still the newest
 * history entry and editing is allowed (not after a switch to field mode).
 */
export function toastUndoable(message: string) {
    const { past } = useProject.getState();
    const entry = past[past.length - 1];
    toast(message, {
        action: {
            label: t('common.undo'),
            run: () => {
                const state = useProject.getState();
                if (!entry || state.past[state.past.length - 1] !== entry || !canEdit()) {
                    toast(t('common.undoGone'), { tone: 'warn' });
                    return;
                }
                state.undo();
            },
        },
    });
}

/** Whether a known team id still exists (stale ids from deleted teams are ignored). */
export function existingTeamId(project: Project, teamId: string | null | undefined): string | undefined {
    return teamId && project.teams.some((team) => team.id === teamId) ? teamId : undefined;
}

/** Log entries are an operations record: allowed in field mode, never for viewers or copies. */
export function canLog(): boolean {
    const { readOnly, project } = useProject.getState();
    return Boolean(project) && !readOnly;
}

export function duplicateSelection() {
    const project = useProject.getState().project;
    const { selection } = useUi.getState();
    if (!project || !canEdit()) {
        return;
    }
    const fallback = activeLayerId(project);
    const usable = new Set(project.layers.filter((layer) => !layer.locked && layer.visible).map((layer) => layer.id));
    const copies = project.elements.filter((element) => selection.includes(element.id)).map((element) => ({
        ...translateElement(element, 0.00012, -0.00008),
        id: uid('el'),
        locked: undefined,
        sourceId: undefined,
        layerId: usable.has(element.layerId ?? project.layers[0]?.id) ? element.layerId : fallback ?? undefined,
    }) as Element).filter((element) => element.layerId);
    if (copies.length === 0) {
        return;
    }
    mutate(t('common.duplicate'), (draft) => {
        draft.elements.push(...(copies as Draft<Element>[]));
    });
    useUi.getState().set({ selection: copies.map((c) => c.id) });
}

export function toggleLockSelection() {
    const project = useProject.getState().project;
    const { selection } = useUi.getState();
    if (!project || selection.length === 0 || !canEdit()) {
        return;
    }
    const targets = project.elements.filter((element) => selection.includes(element.id));
    const lock = targets.some((element) => !element.locked);
    mutate(lock ? t('common.lock') : t('common.unlock'), (draft) => {
        for (const element of draft.elements) {
            if (selection.includes(element.id)) {
                if (lock) {
                    element.locked = true;
                } else {
                    delete element.locked;
                }
            }
        }
    });
}

export function nudgeSelection(dxPx: number, dyPx: number, unproject: (px: [number, number]) => LngLat, project0: (p: LngLat) => [number, number]) {
    const project = useProject.getState().project;
    const { selection } = useUi.getState();
    if (!project || !canEdit() || selection.length === 0) {
        return;
    }
    const first = project.elements.find((element) => selection.includes(element.id));
    if (!first) {
        return;
    }
    const anchor = elementAnchor(first);
    const screen = project0(anchor);
    const target = unproject([screen[0] + dxPx, screen[1] + dyPx]);
    const dLng = target[0] - anchor[0];
    const dLat = target[1] - anchor[1];
    const movable = new Set(project.elements.filter((element) => selection.includes(element.id) && !elementLocked(project, element)).map((element) => element.id));
    if (movable.size === 0) {
        return;
    }
    mutate(t('common.edit'), (draft) => {
        draft.elements.forEach((element, i) => {
            if (movable.has(element.id)) {
                draft.elements[i] = translateElement(element as Element, dLng, dLat) as Draft<Element>;
            }
        });
    }, { key: `nudge:${selection.join(',')}` });
}

function inkAllowed(): boolean {
    const { mode, streamer } = useUi.getState();
    return streamer !== 'off' || mode === 'briefing' || canEdit();
}

export function armTool(tool: ToolId): boolean {
    const ui = useUi.getState();
    const allowed = tool === 'select' || tool === 'measure' || ((tool === 'draw' || tool === 'erase') ? inkAllowed() : canEdit());
    if (!allowed) {
        toast(t('mode.fieldLocked'), { tone: 'warn' });
        return false;
    }
    ui.setTool(tool);
    return true;
}

/** Apply a numeric subtype after a tool key (M→1–8, R→1–4, Z→1–8, D→1–5, U→1–9). */
export function applySubtype(tool: ToolId | 'unit', digit: number) {
    const ui = useUi.getState();
    const project = useProject.getState().project;
    if ((tool === 'marker' || tool === 'route' || tool === 'zone') && !canEdit()) {
        return;
    }
    if (tool === 'draw' && !inkAllowed()) {
        return;
    }
    if (tool === 'marker' && MARKER_TYPES[digit - 1]) {
        ui.set({ markerType: MARKER_TYPES[digit - 1] });
        if (ui.tool !== 'marker') {
            ui.setTool('marker');
        }
    } else if (tool === 'route' && ROUTE_STYLES[digit - 1]) {
        ui.set({ routeStyle: ROUTE_STYLES[digit - 1] });
        if (ui.tool !== 'route') {
            ui.setTool('route');
        }
    } else if (tool === 'zone' && ZONE_CATEGORIES[digit - 1]) {
        ui.set({ zoneCategory: ZONE_CATEGORIES[digit - 1] });
        if (ui.tool !== 'zone') {
            ui.setTool('zone');
        }
    } else if (tool === 'draw' && digit <= 5) {
        ui.set({ drawColor: digit - 1 });
        if (ui.tool !== 'draw') {
            ui.setTool('draw');
        }
    } else if (tool === 'unit' && project) {
        const friendly = project.teams.filter((team) => team.side !== 'enemy');
        const team = friendly[digit - 1];
        if (team) {
            ui.set({ activeTeamId: team.id });
            const marker = project.elements.find((element) => element.kind === 'marker' && element.teamId === team.id);
            if (marker) {
                ui.select([marker.id]);
            }
            toast(team.name);
        }
    }
}

export function cycleAppearance(backwards = false) {
    const prefs = usePrefs.getState();
    const index = APPEARANCE_ORDER.indexOf(prefs.appearance);
    const next = APPEARANCE_ORDER[(index + (backwards ? -1 : 1) + APPEARANCE_ORDER.length) % APPEARANCE_ORDER.length];
    prefs.set({ appearance: next });
}

export function cycleStreamer() {
    const ui = useUi.getState();
    const order = ['off', 'field', 'public'] as const;
    const next = order[(order.indexOf(ui.streamer) + 1) % order.length];
    // Privacy overlay only: tool, drafts, selection and panels stay as they are.
    ui.set({ streamer: next, streamerInk: next === 'off' ? [] : ui.streamerInk });
    toastStreamer(next);
}

export function toastStreamer(profile: 'off' | 'field' | 'public') {
    toast(profile === 'off' ? `${t('streamer.title')}: ${t('streamer.off')}` : t('streamer.badge', { profile: t(`streamer.${profile}`) }));
}

export function logEvent(text: string, elementId?: string, teamId?: string) {
    if (!canLog()) {
        return;
    }
    mutate(t('panel.log'), (draft) => {
        draft.log.push({ id: uid('log'), t: nowIso(), text, elementId, teamId });
    });
}
