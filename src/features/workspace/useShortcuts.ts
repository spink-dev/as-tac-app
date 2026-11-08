import { useEffect } from 'react';
import { useUi, type ToolId } from '../../core/store/ui';
import { useProject } from '../../core/store/project';
import { usePrefs } from '../../core/store/prefs';
import { bindingFor, eventCombo, SHORTCUTS } from '../../core/shortcuts/registry';
import { applySubtype, armTool, cycleAppearance, cycleStreamer, deleteSelection, duplicateSelection, nudgeSelection, toggleLockSelection } from '../../core/actions';
import { cancelDraft, finishDraft, removeLastDraftPoint } from '../../map/interaction';
import { mapRef } from '../../map/MapView';
import { setMode } from './modes';
import { showDialog } from '../../core/store/dialogs';
import { stepPhase } from '../briefing/briefing';
import { locateOnce } from '../field/gps';
import { t } from '../../i18n';

const SUBTYPE_LAYERS: Record<string, ToolId | 'unit'> = { 'tool.marker': 'marker', 'tool.route': 'route', 'tool.zone': 'zone', 'tool.draw': 'draw', 'unit.pick': 'unit' };

function typing(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return Boolean(element?.closest?.('input, textarea, select, [contenteditable="true"], dialog[open]'));
}

/** Enter/Space on a focused control belong to that control. */
function onControl(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return Boolean(element?.closest?.('button, a[href], [role="menuitem"], [role="option"], [role="tab"], summary'));
}

/** Global keyboard handling for the workspace. Keys come from the registry only. */
export function useShortcuts() {
    useEffect(() => {
        let layer: ToolId | 'unit' | null = null;
        let layerTimer = 0;
        const onKey = (event: KeyboardEvent) => {
            if (typing(event.target) || event.repeat && !event.key.startsWith('Arrow')) {
                return;
            }
            const combo = eventCombo(event);
            const overrides = usePrefs.getState().keybinds;
            const ui = useUi.getState();
            // While the palette is open it owns the keyboard (except its own toggle and Escape).
            if (ui.palette && combo !== 'escape' && combo !== bindingFor('view.palette', overrides)) {
                return;
            }

            if (layer && /^[1-9]$/.test(event.key)) {
                applySubtype(layer, Number(event.key));
                event.preventDefault();
                return;
            }
            if (layer === 'zone' && event.key === 'Tab') {
                ui.set({ zoneShape: ui.zoneShape === 'polygon' ? 'circle' : 'polygon', draft: null });
                event.preventDefault();
                return;
            }
            if (layer === 'draw' && (event.key === '[' || event.key === ']')) {
                ui.set({ drawWidth: Math.max(1, Math.min(16, ui.drawWidth + (event.key === ']' ? 2 : -2))) });
                event.preventDefault();
                return;
            }
            if (ui.selection.length > 0 && ui.mode === 'plan' && event.key.startsWith('Arrow') && !ui.draft) {
                const map = mapRef.current;
                if (map) {
                    const step = event.shiftKey ? 10 : 1;
                    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                    nudgeSelection(dx, dy, (px) => {
                        const p = map.unproject(px);
                        return [p.lng, p.lat];
                    }, (p) => {
                        const s = map.project(p);
                        return [s.x, s.y];
                    });
                    event.preventDefault();
                    return;
                }
            }
            const action = SHORTCUTS.find((s) => bindingFor(s.id, overrides) === combo);
            if (!action) {
                return;
            }
            if (action.id === 'edit.finish' && (onControl(event.target) || !ui.draft)) {
                return;
            }
            if (action.id.startsWith('briefing.') && ui.mode !== 'briefing') {
                return;
            }
            event.preventDefault();
            window.clearTimeout(layerTimer);
            layer = null;
            if (action.id.startsWith('tool.') || action.id === 'unit.pick') {
                const armed = action.id === 'unit.pick' || armTool(action.id.slice(5) as ToolId);
                layer = armed ? SUBTYPE_LAYERS[action.id] ?? null : null;
                if (layer) {
                    layerTimer = window.setTimeout(() => {
                        layer = null;
                    }, 1600);
                }
                return;
            }
            switch (action.id) {
                case 'edit.undo': {
                    if (ui.mode !== 'plan') {
                        break;
                    }
                    const label = useProject.getState().undo();
                    if (label) {
                        ui.toast(`${t('common.undo')}: ${label}`);
                    }
                    break;
                }
                case 'edit.redo':
                case 'edit.redoAlt':
                    if (ui.mode === 'plan') {
                        useProject.getState().redo();
                    }
                    break;
                case 'edit.delete':
                case 'edit.deleteAlt':
                    if (ui.draft) {
                        removeLastDraftPoint();
                    } else {
                        deleteSelection();
                    }
                    break;
                case 'edit.duplicate':
                    duplicateSelection();
                    break;
                case 'edit.lock':
                    toggleLockSelection();
                    break;
                case 'edit.finish':
                    finishDraft(event.shiftKey);
                    break;
                case 'edit.cancel':
                    if (!cancelDraft()) {
                        if (ui.palette || ui.shortcutsOpen) {
                            ui.set({ palette: false, shortcutsOpen: false });
                        } else if (ui.mode === 'briefing') {
                            setMode('plan');
                        } else if (ui.tool !== 'select') {
                            ui.setTool('select');
                        } else if (ui.selection.length > 0) {
                            ui.set({ selection: [] });
                        } else {
                            ui.openPanel(null);
                        }
                    }
                    break;
                case 'view.palette':
                    ui.set({ palette: !ui.palette });
                    break;
                case 'view.field':
                    setMode(ui.mode === 'field' ? 'plan' : 'field');
                    break;
                case 'view.briefing':
                    setMode(ui.mode === 'briefing' ? 'plan' : 'briefing');
                    break;
                case 'view.appearance':
                    cycleAppearance(event.shiftKey);
                    break;
                case 'view.streamer':
                    cycleStreamer();
                    break;
                case 'view.layers':
                    ui.openPanel('layers');
                    break;
                case 'view.help':
                    showDialog('shortcuts');
                    break;
                case 'view.locate':
                    locateOnce();
                    break;
                case 'briefing.next':
                case 'briefing.prev':
                    if (ui.mode === 'briefing') {
                        stepPhase(action.id === 'briefing.next' ? 1 : -1);
                    }
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.clearTimeout(layerTimer);
        };
    }, []);
}
