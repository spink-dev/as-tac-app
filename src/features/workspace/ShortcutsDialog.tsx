import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import { useDialogs } from '../../core/store/dialogs';
import { usePrefs } from '../../core/store/prefs';
import { Button, Dialog, IconButton } from '../../ui/components';
import { bindingFor, eventCombo, findConflict, formatCombo, SHORTCUTS, type ShortcutGroup } from '../../core/shortcuts/registry';

const GROUPS: ShortcutGroup[] = ['tools', 'edit', 'view', 'briefing'];

/** Keys that drive focus, buttons, nudging or the draw width; never offered as custom bindings. */
const ARROWS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const RESERVED = new Set([
    'tab', 'shift+tab', 'space', 'shift+space', 'enter', 'shift+enter', 'escape', 'home', 'end', 'pageup', 'pagedown', '[', ']',
    ...ARROWS, ...ARROWS.map((key) => `shift+${key}`),
]);
const GROUP_LABEL: Record<ShortcutGroup, 'mode.plan' | 'common.edit' | 'settings.device' | 'mode.briefing'> = { tools: 'mode.plan', edit: 'common.edit', view: 'settings.device', briefing: 'mode.briefing' };

/** Overview doubles as the rebinding UI: press-a-key capture, conflicts, per-binding reset. */
export function ShortcutsDialog() {
    const t = useT();
    const open = useDialogs((state) => state.open === 'shortcuts');
    const hide = useDialogs((state) => state.hide);
    const keybinds = usePrefs((state) => state.keybinds);
    const set = usePrefs((state) => state.set);
    const [capturing, setCapturing] = useState<string | null>(null);
    const [conflict, setConflict] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setCapturing(null);
            setConflict(null);
        }
    }, [open]);

    useEffect(() => {
        if (!capturing || !open) {
            return;
        }
        const onKey = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (['Shift', 'Control', 'Meta', 'Alt'].includes(event.key)) {
                return;
            }
            if (event.key === 'Escape') {
                setCapturing(null);
                return;
            }
            const combo = eventCombo(event);
            if (/^[0-9]$/.test(combo)) {
                setConflict(t('shortcuts.hint'));
                return;
            }
            // A reserved key is only accepted as the action's own default (e.g. Enter to finish).
            if (RESERVED.has(combo) && bindingFor(capturing, {}) !== combo) {
                setConflict(t('shortcuts.reserved'));
                return;
            }
            const clash = findConflict(capturing, combo, keybinds);
            if (clash) {
                setConflict(t('shortcuts.conflict', { action: t(clash.label) }));
                return;
            }
            set({ keybinds: { ...keybinds, [capturing]: combo } });
            setConflict(null);
            setCapturing(null);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [capturing, open, keybinds, set, t]);

    return (
        <Dialog open={open} onClose={() => {
            setCapturing(null);
            hide();
        }} title={t('shortcuts.title')} footer={<Button variant="ghost" onClick={() => set({ keybinds: {} })}>{t('shortcuts.resetAll')}</Button>}>
            <p className="field__hint">{t('shortcuts.hint')}</p>
            {conflict ? <div className="notice notice--warn" role="alert">{conflict}</div> : null}
            {GROUPS.map((group) => (
                <section key={group} className="section">
                    <div className="section__title">{t(GROUP_LABEL[group])}</div>
                    <ul className="shortcut-list">
                        {SHORTCUTS.filter((s) => s.group === group && !s.id.endsWith('Alt')).map((shortcut) => {
                            const combo = bindingFor(shortcut.id, keybinds);
                            const custom = shortcut.id in keybinds;
                            return (
                                <li key={shortcut.id} className="shortcut-row">
                                    <span className="spacer">{t(shortcut.label)}</span>
                                    <button type="button" className={`kbd kbd--button ${capturing === shortcut.id ? 'is-capturing' : ''}`} onClick={() => {
                                        setConflict(null);
                                        setCapturing(shortcut.id);
                                    }} aria-label={`${t(shortcut.label)}: ${formatCombo(combo)}`}>
                                        {capturing === shortcut.id ? t('shortcuts.press') : formatCombo(combo)}
                                    </button>
                                    {custom ? (
                                        <IconButton small label={t('shortcuts.reset')} onClick={() => {
                                            const next = { ...keybinds };
                                            delete next[shortcut.id];
                                            set({ keybinds: next });
                                        }}><RotateCcw size={14} /></IconButton>
                                    ) : <span className="icon-btn--sm" />}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ))}
        </Dialog>
    );
}
