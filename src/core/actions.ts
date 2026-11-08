import type { Draft } from 'immer';
import { mutate, useProject } from './store/project';
import { toast, useUi, type ToolId } from './store/ui';
import { APPEARANCE_ORDER, usePrefs } from './store/prefs';
import { uid, nowIso } from './model/factory';
import type { Element, LngLat, MarkerType, Project, RouteStyle, ZoneCategory } from './model/schema';
import { translateElement } from './model/geometry';
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

export function activeLayerId(project: Project): string {
    const wanted = useUi.getState().activeLayerId;
    const unlocked = project.layers.filter((layer) => !layer.locked);
    if (wanted && unlocked.some((layer) => layer.id === wanted)) {
        return wanted;
    }
    return (unlocked[unlocked.length - 1] ?? project.layers[project.layers.length - 1]).id;
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
    if (!project) {
        return element.id;
    }
    const withLayer = { ...element, layerId: element.layerId ?? activeLayerId(project) };
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
    const removable = project.elements.filter((element) => ids.has(element.id) && !element.locked);
    const strokes = project.drawings.filter((stroke) => ids.has(stroke.id));
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
    toast(removed.size === 1 && name ? t('inspector.deleted', { name }) : t('inspector.deletedMany', { n: removed.size }), {
        action: { label: t('common.undo'), run: () => useProject.getState().undo() },
    });
}

export function duplicateSelection() {
    const project = useProject.getState().project;
    const { selection } = useUi.getState();
    if (!project || !canEdit()) {
        return;
    }
    const copies = project.elements.filter((element) => selection.includes(element.id)).map((element) => ({
        ...translateElement(element, 0.00012, -0.00008),
        id: uid('el'),
        locked: undefined,
        sourceId: undefined,
    }) as Element);
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
    if (!project || selection.length === 0 || useProject.getState().readOnly) {
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
    mutate(t('common.edit'), (draft) => {
        draft.elements.forEach((element, i) => {
            if (selection.includes(element.id) && !element.locked) {
                draft.elements[i] = translateElement(element as Element, dLng, dLat) as Draft<Element>;
            }
        });
    }, { key: `nudge:${selection.join(',')}` });
}

export function armTool(tool: ToolId) {
    const ui = useUi.getState();
    if (!canEdit() && !(tool === 'draw' || tool === 'erase' || tool === 'select' || tool === 'measure')) {
        toast(t('mode.fieldLocked'), { tone: 'warn' });
        return;
    }
    ui.setTool(tool);
}

/** Apply a numeric subtype after a tool key (M→1–8, R→1–4, Z→1–8, D→1–5, U→1–9). */
export function applySubtype(tool: ToolId | 'unit', digit: number) {
    const ui = useUi.getState();
    const project = useProject.getState().project;
    if (tool === 'marker' && MARKER_TYPES[digit - 1]) {
        ui.set({ markerType: MARKER_TYPES[digit - 1], tool: 'marker' });
    } else if (tool === 'route' && ROUTE_STYLES[digit - 1]) {
        ui.set({ routeStyle: ROUTE_STYLES[digit - 1], tool: 'route' });
    } else if (tool === 'zone' && ZONE_CATEGORIES[digit - 1]) {
        ui.set({ zoneCategory: ZONE_CATEGORIES[digit - 1], tool: 'zone' });
    } else if (tool === 'draw' && digit <= 5) {
        ui.set({ drawColor: digit - 1, tool: 'draw' });
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
    toast(next === 'off' ? `${t('streamer.title')}: ${t('streamer.off')}` : t('streamer.badge', { profile: t(`streamer.${next}`) }));
}

export function logEvent(text: string, elementId?: string, teamId?: string) {
    mutate(t('panel.log'), (draft) => {
        draft.log.push({ id: uid('log'), t: nowIso(), text, elementId, teamId });
    });
}
