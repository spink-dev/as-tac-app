import { useEffect, useRef, useState, type ComponentType } from 'react';
import gsap from 'gsap';
import { BookOpen, Flag, Layers, Map as MapIcon, Presentation, Radio, Settings, Share2, SlidersHorizontal, X } from 'lucide-react';
import { useT, type StringKey } from '../../i18n';
import { useUi, type PanelId, type SheetSnap } from '../../core/store/ui';
import { useLive } from '../../core/live/state';
import { ICON, IconButton, prefersReducedMotion, useSmoothScroll } from '../../ui/components';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';
import { TeamsPanel } from './TeamsPanel';
import { SettingsPanel } from './SettingsPanel';
import { LogPanel } from './LogPanel';
import { PANEL_EXTENSIONS } from './registry';

interface PanelDef {
    id: PanelId;
    label: StringKey;
    icon: typeof Layers;
    Component: ComponentType;
}

const CORE: PanelDef[] = [
    { id: 'inspector', label: 'panel.inspector', icon: SlidersHorizontal, Component: Inspector },
    { id: 'layers', label: 'panel.layers', icon: Layers, Component: LayersPanel },
    { id: 'teams', label: 'panel.teams', icon: Flag, Component: TeamsPanel },
    { id: 'settings', label: 'panel.settings', icon: Settings, Component: SettingsPanel },
    { id: 'log', label: 'panel.log', icon: BookOpen, Component: LogPanel },
];

const ICONS: Partial<Record<PanelId, typeof Layers>> = { phases: Presentation, maps: MapIcon, share: Share2, live: Radio };
const ORDER: PanelId[] = ['inspector', 'layers', 'teams', 'phases', 'maps', 'share', 'live', 'settings', 'log'];

function panels(): PanelDef[] {
    const extra = PANEL_EXTENSIONS.map((ext) => ({ ...ext, icon: ICONS[ext.id] ?? Layers }));
    return [...CORE, ...extra].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

const SNAP_VH: Record<Exclude<SheetSnap, 'closed'>, number> = { peek: 0.34, half: 0.6, full: 0.92 };

function useNarrow() {
    const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches);
    useEffect(() => {
        const query = window.matchMedia('(max-width: 760px)');
        const update = () => setNarrow(query.matches);
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update);
    }, []);
    return narrow;
}

/** Desktop: right-hand panel. Phone: bottom sheet with three snap points (GSAP). */
export function PanelHost() {
    const t = useT();
    const panel = useUi((state) => state.panel);
    const sheet = useUi((state) => state.sheet);
    const mode = useUi((state) => state.mode);
    const unread = useLive((state) => state.unread);
    const narrow = useNarrow();
    const ref = useRef<HTMLElement>(null);
    const drag = useRef<{ startY: number; startH: number } | null>(null);
    const body = useSmoothScroll<HTMLDivElement>();
    const defs = panels();
    const open = panel !== null && sheet !== 'closed' && mode !== 'briefing';
    const active = defs.find((def) => def.id === panel) ?? defs[0];

    useEffect(() => {
        const element = ref.current;
        if (!element || !narrow) {
            if (element) {
                gsap.set(element, { clearProps: 'height' });
            }
            return;
        }
        const target = open ? window.innerHeight * (SNAP_VH[sheet as Exclude<SheetSnap, 'closed'>] ?? SNAP_VH.peek) : 0;
        if (prefersReducedMotion()) {
            gsap.set(element, { height: target });
        } else {
            gsap.to(element, { height: target, duration: 0.32, ease: 'expo.out', overwrite: true });
        }
    }, [open, sheet, narrow]);

    const onPointerDown = (event: React.PointerEvent) => {
        if (!narrow || !ref.current) {
            return;
        }
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { startY: event.clientY, startH: ref.current.getBoundingClientRect().height };
    };
    const onPointerMove = (event: React.PointerEvent) => {
        if (!drag.current || !ref.current) {
            return;
        }
        const height = Math.max(0, Math.min(window.innerHeight * 0.95, drag.current.startH - (event.clientY - drag.current.startY)));
        gsap.set(ref.current, { height });
    };
    const onPointerUp = (event: React.PointerEvent) => {
        if (!drag.current || !ref.current) {
            return;
        }
        const moved = event.clientY - drag.current.startY;
        const height = ref.current.getBoundingClientRect().height / window.innerHeight;
        drag.current = null;
        if (Math.abs(moved) < 6) {
            const order: SheetSnap[] = ['peek', 'half', 'full'];
            useUi.getState().set({ sheet: order[(order.indexOf(sheet) + 1) % order.length] });
            return;
        }
        // Nearest snap point; a flick far below the peek closes the sheet.
        const options: [SheetSnap, number][] = [['closed', 0], ['peek', SNAP_VH.peek], ['half', SNAP_VH.half], ['full', SNAP_VH.full]];
        const nearest = options.reduce((best, option) => (Math.abs(option[1] - height) < Math.abs(best[1] - height) ? option : best));
        if (nearest[0] === 'closed') {
            useUi.getState().openPanel(null);
        } else {
            useUi.getState().set({ sheet: nearest[0] });
            gsap.to(ref.current, { height: window.innerHeight * SNAP_VH[nearest[0] as Exclude<SheetSnap, 'closed'>], duration: 0.28, ease: 'expo.out' });
        }
    };

    if (!open && !narrow) {
        return null;
    }
    const Body = active.Component;
    return (
        <aside ref={ref} className={`panel ${open ? 'is-open' : ''}`} aria-label={t(active.label)} aria-hidden={!open} data-testid="panel">
            <div className="panel__grip" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                <span className="panel__handle" />
            </div>
            <div className="panel__head">
                <div className="tabs" role="tablist" aria-label={t('panel.tabs')} onKeyDown={(event) => {
                    // Roving focus: arrows / Home / End move between tabs and activate them.
                    const index = defs.findIndex((def) => def.id === active.id);
                    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1
                        : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1
                            : event.key === 'Home' ? 0 : event.key === 'End' ? defs.length - 1 : null;
                    if (next === null) {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    const target = defs[(next + defs.length) % defs.length];
                    useUi.getState().set({ panel: target.id });
                    requestAnimationFrame(() => document.getElementById(`tab-${target.id}`)?.focus());
                }}>
                    {defs.map((def) => {
                        const Icon = def.icon;
                        const selected = def.id === active.id;
                        return (
                            <button key={def.id} id={`tab-${def.id}`} type="button" role="tab" className="tab" aria-selected={selected} aria-controls="panel-body" tabIndex={selected ? 0 : -1} onClick={() => useUi.getState().set({ panel: def.id })} title={t(def.label)}>
                                <Icon size={16} strokeWidth={1.9} />
                                <span className="tab__label">{t(def.label)}</span>
                                {def.id === 'live' && unread > 0 ? <span className="tab__badge num">{unread}</span> : null}
                            </button>
                        );
                    })}
                </div>
                <IconButton label={t('common.close')} onClick={() => useUi.getState().openPanel(null)}><X {...ICON} /></IconButton>
            </div>
            <div className="panel__body" ref={body}>
                <div className="panel__content" role="tabpanel" id="panel-body" aria-labelledby={`tab-${active.id}`} tabIndex={0}>
                    {open ? <Body /> : null}
                </div>
            </div>
        </aside>
    );
}
