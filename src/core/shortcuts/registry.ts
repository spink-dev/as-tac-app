import type { StringKey } from '../../i18n';
import { usePrefs } from '../store/prefs';

/**
 * Every keyboard shortcut is declared once here. Feature code reacts to action ids and never
 * compares raw keys; displayed hints are formatted from the (possibly remapped) binding.
 * Bindings are device-local preferences (prefs.keybinds) and never part of a plan file.
 */
export type ShortcutGroup = 'tools' | 'edit' | 'view' | 'briefing';

export interface ShortcutDef {
    id: string;
    keys: string;
    label: StringKey;
    group: ShortcutGroup;
    /** Layer a binding lives in; digits only exist inside a tool layer. */
    layer?: 'global' | 'subtype';
}

export const SHORTCUTS: ShortcutDef[] = [
    { id: 'tool.select', keys: 'v', label: 'tool.select', group: 'tools' },
    { id: 'tool.marker', keys: 'm', label: 'tool.marker', group: 'tools' },
    { id: 'tool.route', keys: 'r', label: 'tool.route', group: 'tools' },
    { id: 'tool.zone', keys: 'z', label: 'tool.zone', group: 'tools' },
    { id: 'tool.text', keys: 't', label: 'tool.text', group: 'tools' },
    { id: 'tool.draw', keys: 'd', label: 'tool.draw', group: 'tools' },
    { id: 'tool.erase', keys: 'e', label: 'tool.erase', group: 'tools' },
    { id: 'tool.bearing', keys: 'b', label: 'tool.bearing', group: 'tools' },
    { id: 'tool.measure', keys: 'g', label: 'tool.measure', group: 'tools' },
    { id: 'unit.pick', keys: 'u', label: 'common.team', group: 'tools' },
    { id: 'edit.undo', keys: 'mod+z', label: 'common.undo', group: 'edit' },
    { id: 'edit.redo', keys: 'mod+shift+z', label: 'common.redo', group: 'edit' },
    { id: 'edit.redoAlt', keys: 'mod+y', label: 'common.redo', group: 'edit' },
    { id: 'edit.delete', keys: 'delete', label: 'common.delete', group: 'edit' },
    { id: 'edit.deleteAlt', keys: 'backspace', label: 'common.delete', group: 'edit' },
    { id: 'edit.duplicate', keys: 'mod+d', label: 'common.duplicate', group: 'edit' },
    { id: 'edit.finish', keys: 'enter', label: 'draft.finish', group: 'edit' },
    { id: 'edit.cancel', keys: 'escape', label: 'draft.cancel', group: 'edit' },
    { id: 'edit.lock', keys: 'l', label: 'common.lock', group: 'edit' },
    { id: 'view.palette', keys: 'mod+k', label: 'common.search', group: 'view' },
    { id: 'view.field', keys: 'k', label: 'mode.field', group: 'view' },
    { id: 'view.briefing', keys: 'h', label: 'mode.briefing', group: 'view' },
    { id: 'view.appearance', keys: 'n', label: 'appearance.toggle', group: 'view' },
    { id: 'view.streamer', keys: 'shift+s', label: 'streamer.title', group: 'view' },
    { id: 'view.layers', keys: 'shift+l', label: 'panel.layers', group: 'view' },
    { id: 'view.help', keys: 'shift+?', label: 'shortcuts.title', group: 'view' },
    { id: 'view.locate', keys: 'shift+g', label: 'field.locate', group: 'view' },
    { id: 'briefing.next', keys: 'arrowright', label: 'common.next', group: 'briefing' },
    { id: 'briefing.prev', keys: 'arrowleft', label: 'common.back', group: 'briefing' },
];

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function bindingFor(id: string, overrides: Record<string, string>): string {
    return overrides[id] ?? SHORTCUTS.find((s) => s.id === id)?.keys ?? '';
}

/** Normalise a KeyboardEvent into the registry notation, e.g. "mod+shift+z". */
export function eventCombo(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.metaKey || event.ctrlKey) {
        parts.push('mod');
    }
    if (event.altKey) {
        parts.push('alt');
    }
    let key = event.key.toLowerCase();
    if (key === ' ') {
        key = 'space';
    }
    if (event.shiftKey && (key.length > 1 || /[a-z]/.test(key) || key === '?')) {
        parts.push('shift');
    }
    parts.push(key);
    return parts.join('+');
}

/** Key names as printed on Swiss keyboards (Ctrl, Delete); only the space bar gets a German word. */
export function formatCombo(combo: string): string {
    const de = usePrefs.getState().locale !== 'en';
    return combo.split('+').map((part) => {
        switch (part) {
            case 'mod':
                return MAC ? '⌘' : 'Ctrl';
            case 'shift':
                return MAC ? '⇧' : 'Shift';
            case 'alt':
                return MAC ? '⌥' : 'Alt';
            case 'escape':
                return 'Esc';
            case 'enter':
                return '↵';
            case 'delete':
                return 'Del';
            case 'backspace':
                return '⌫';
            case 'arrowright':
                return '→';
            case 'arrowleft':
                return '←';
            case 'space':
                return de ? 'Leertaste' : 'Space';
            default:
                return part.toUpperCase();
        }
    }).join(MAC ? '' : '+');
}

export function findConflict(id: string, combo: string, overrides: Record<string, string>): ShortcutDef | undefined {
    return SHORTCUTS.find((s) => s.id !== id && bindingFor(s.id, overrides) === combo);
}

export function shortcutHint(id: string, overrides: Record<string, string>): string {
    const combo = bindingFor(id, overrides);
    return combo ? formatCombo(combo) : '';
}
