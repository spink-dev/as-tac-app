import { create } from 'zustand';
import type { Element, LngLat, MarkerType, RouteStyle, Stroke, ZoneCategory } from '../model/schema';

export type Mode = 'plan' | 'field' | 'briefing';
export type ToolId = 'select' | 'marker' | 'route' | 'zone' | 'text' | 'draw' | 'erase' | 'bearing' | 'measure';
export type PanelId = 'inspector' | 'layers' | 'teams' | 'phases' | 'maps' | 'share' | 'live' | 'settings' | 'log';
export type StreamerProfile = 'off' | 'field' | 'public';
export type SheetSnap = 'closed' | 'peek' | 'half' | 'full';

export const DRAW_COLORS = ['#e8402a', '#f2c230', '#2f9fe0', '#3bb273', '#f4f4f4'];

export interface Draft {
    tool: ToolId;
    points: LngLat[];
    /** Live cursor position while drafting (rubber band). */
    hover?: LngLat;
    /** Route seeded from a selected unit belongs to that unit's team. */
    teamId?: string;
}

export interface Toast {
    id: number;
    text: string;
    tone?: 'info' | 'ok' | 'warn' | 'danger';
    action?: { label: string; run: () => void };
}

interface UiState {
    mode: Mode;
    tool: ToolId;
    markerType: MarkerType;
    routeStyle: RouteStyle;
    zoneCategory: ZoneCategory;
    zoneShape: 'polygon' | 'circle';
    drawColor: number;
    drawWidth: number;
    eraserPx: number;
    activeTeamId: string | null;
    activeLayerId: string | null;
    selection: string[];
    panel: PanelId | null;
    sheet: SheetSnap;
    streamer: StreamerProfile;
    phaseIndex: number;
    briefingInk: Stroke[];
    streamerInk: Stroke[];
    draft: Draft | null;
    cursor: LngLat | null;
    palette: boolean;
    shortcutsOpen: boolean;
    toasts: Toast[];
    navTargetId: string | null;
    imageEditId: string | null;
    areaPicker: boolean;
    /** Live preview of an element being dragged; committed as one undo step on release. */
    override: Element | null;
    /** Pending measurement (session only). */
    measure: LngLat[] | null;
    setTool: (tool: ToolId) => void;
    set: (patch: Partial<UiState>) => void;
    select: (ids: string[], additive?: boolean) => void;
    openPanel: (panel: PanelId | null) => void;
    toast: (text: string, options?: Omit<Toast, 'id' | 'text'>) => void;
    dismissToast: (id: number) => void;
    resetSession: () => void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
    mode: 'plan',
    tool: 'select',
    markerType: 'unit',
    routeStyle: 'planned',
    zoneCategory: 'ao',
    zoneShape: 'polygon',
    drawColor: 0,
    drawWidth: 4,
    eraserPx: 22,
    activeTeamId: null,
    activeLayerId: null,
    selection: [],
    panel: null,
    sheet: 'closed',
    streamer: 'off',
    phaseIndex: 0,
    briefingInk: [],
    streamerInk: [],
    draft: null,
    cursor: null,
    palette: false,
    shortcutsOpen: false,
    toasts: [],
    navTargetId: null,
    imageEditId: null,
    areaPicker: false,
    override: null,
    measure: null,
    setTool(tool) {
        // Arming a creation tool ends image alignment (the two would fight over map input).
        set({ tool, draft: null, measure: tool === 'measure' ? get().measure : null, imageEditId: tool === 'select' ? get().imageEditId : null });
    },
    set(patch) {
        set(patch);
    },
    select(ids, additive = false) {
        const current = get().selection;
        if (additive) {
            const next = new Set(current);
            for (const id of ids) {
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                }
            }
            set({ selection: [...next] });
            return;
        }
        set({ selection: ids });
        // Plan mode opens the inspector; the field panel shows the selection itself (map stays free).
        if (ids.length > 0 && get().mode === 'plan') {
            set({ panel: 'inspector', sheet: get().sheet === 'closed' ? 'peek' : get().sheet });
        }
    },
    openPanel(panel) {
        const state = get();
        if (panel === null || (state.panel === panel && state.sheet !== 'closed')) {
            set({ panel: null, sheet: 'closed' });
            return;
        }
        set({ panel, sheet: state.sheet === 'closed' || state.sheet === 'peek' ? 'half' : state.sheet });
    },
    toast(text, options = {}) {
        const id = ++toastId;
        set({ toasts: [...get().toasts.slice(-2), { id, text, ...options }] });
        window.setTimeout(() => get().dismissToast(id), options.action ? 6000 : 3200);
    },
    dismissToast(id) {
        set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
    },
    resetSession() {
        set({
            mode: 'plan', tool: 'select', selection: [], panel: null, sheet: 'closed', draft: null, phaseIndex: 0,
            briefingInk: [], streamerInk: [], streamer: 'off', navTargetId: null, imageEditId: null, activeLayerId: null, activeTeamId: null,
            override: null, measure: null,
        });
    },
}));

export function toast(text: string, options?: Omit<Toast, 'id' | 'text'>) {
    useUi.getState().toast(text, options);
}

// Test hook for the browser suites (read-only view of the selection).
if (typeof window !== 'undefined') {
    (window as unknown as { __asTacSelection: () => string[] }).__asTacSelection = () => useUi.getState().selection;
}
