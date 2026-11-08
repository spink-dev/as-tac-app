import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useT } from '../../i18n';
import { useUi, type PanelId, type ToolId } from '../../core/store/ui';
import { useProject } from '../../core/store/project';
import { usePrefs } from '../../core/store/prefs';
import { armTool, cycleAppearance, cycleStreamer, typeLabel } from '../../core/actions';
import { shortcutHint } from '../../core/shortcuts/registry';
import { elementAnchor, elementTitle, teamMap } from '../../map/planFeatures';
import { flyTo } from '../../map/MapView';
import { setMode } from './modes';
import { showDialog } from '../../core/store/dialogs';
import { closeProject } from '../../core/store/route';

interface Item {
    id: string;
    label: string;
    meta?: string;
    group: 'objects' | 'actions';
    hint?: string;
    run: () => void;
}

/** ⌘K: find any object, tool or action by typing. */
export function CommandPalette() {
    const t = useT();
    const open = useUi((state) => state.palette);
    const project = useProject((state) => state.project);
    const keybinds = usePrefs((state) => state.keybinds);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const close = () => useUi.getState().set({ palette: false });

    useEffect(() => {
        if (open) {
            setQuery('');
            setActive(0);
            requestAnimationFrame(() => input.current?.focus());
        }
    }, [open]);

    const items = useMemo<Item[]>(() => {
        if (!project) {
            return [];
        }
        const teams = teamMap(project);
        const objects: Item[] = project.elements.map((element) => ({
            id: element.id,
            label: elementTitle(element, teams, typeLabel),
            meta: typeLabel(element),
            group: 'objects',
            run: () => {
                flyTo({ center: elementAnchor(element), zoom: 17 });
                useUi.getState().select([element.id]);
            },
        }));
        const tools: ToolId[] = ['select', 'marker', 'route', 'zone', 'text', 'draw', 'erase', 'bearing', 'measure'];
        const panels: PanelId[] = ['layers', 'teams', 'phases', 'maps', 'share', 'live', 'settings', 'log'];
        const actions: Item[] = [
            ...tools.map((tool) => ({ id: `tool.${tool}`, label: t(`tool.${tool}`), group: 'actions' as const, hint: shortcutHint(`tool.${tool}`, keybinds), run: () => armTool(tool) })),
            ...(['plan', 'field', 'briefing'] as const).map((mode) => ({ id: `mode.${mode}`, label: t(`mode.${mode}`), group: 'actions' as const, run: () => setMode(mode) })),
            ...panels.map((panel) => ({ id: `panel.${panel}`, label: t(`panel.${panel}`), group: 'actions' as const, run: () => useUi.getState().set({ panel, sheet: 'half' }) })),
            { id: 'appearance', label: t('appearance.toggle'), group: 'actions', hint: shortcutHint('view.appearance', keybinds), run: () => cycleAppearance() },
            { id: 'streamer', label: t('streamer.title'), group: 'actions', hint: shortcutHint('view.streamer', keybinds), run: () => cycleStreamer() },
            { id: 'shortcuts', label: t('shortcuts.title'), group: 'actions', run: () => showDialog('shortcuts') },
            { id: 'share', label: t('share.title'), group: 'actions', run: () => useUi.getState().set({ panel: 'share', sheet: 'half' }) },
            { id: 'back', label: t('common.back'), group: 'actions', run: () => void closeProject() },
        ];
        return [...objects, ...actions];
    }, [project, keybinds, t]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = q ? items.filter((item) => `${item.label} ${item.meta ?? ''}`.toLowerCase().includes(q)) : items.filter((item) => item.group === 'actions');
        return filtered.slice(0, 40);
    }, [items, query]);

    if (!open) {
        return null;
    }
    const run = (item: Item | undefined) => {
        if (item) {
            close();
            item.run();
        }
    };
    return (
        <div className="palette-backdrop" onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
                close();
            }
        }}>
            <div className="palette" role="dialog" aria-modal="true" aria-label={t('common.search')}>
                <div className="palette__search">
                    <Search size={18} />
                    <input
                        ref={input}
                        value={query}
                        placeholder={t('palette.placeholder')}
                        aria-label={t('palette.placeholder')}
                        aria-controls="palette-results"
                        aria-activedescendant={results[active] ? `pal-${results[active].id}` : undefined}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActive(0);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowDown') {
                                setActive((i) => Math.min(results.length - 1, i + 1));
                                event.preventDefault();
                            } else if (event.key === 'ArrowUp') {
                                setActive((i) => Math.max(0, i - 1));
                                event.preventDefault();
                            } else if (event.key === 'Enter') {
                                run(results[active]);
                            } else if (event.key === 'Escape') {
                                close();
                            }
                        }}
                    />
                </div>
                <ul id="palette-results" className="palette__list" role="listbox">
                    {results.length === 0 ? <li className="palette__empty">{t('palette.empty')}</li> : null}
                    {results.map((item, i) => (
                        <li key={item.id} id={`pal-${item.id}`} role="option" aria-selected={i === active} className="palette__item" onPointerEnter={() => setActive(i)} onClick={() => run(item)}>
                            <span className="palette__label">{item.label}</span>
                            {item.meta ? <span className="palette__meta">{item.meta}</span> : null}
                            {item.hint ? <kbd className="kbd">{item.hint}</kbd> : null}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
