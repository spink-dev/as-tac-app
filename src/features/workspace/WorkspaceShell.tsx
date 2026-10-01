import Appearance from '../appearance/Appearance';
import BrandMark from '../appearance/BrandMark';
import { useEffect, useRef, useState, type ReactNode } from 'react';
export type WorkspaceTab = 'field' | 'plan' | 'briefing' | 'maps' | 'project';
const tabs: { id: WorkspaceTab; label: string; icon: string; title: string }[] = [
    { id: 'field', label: 'Orientierung', icon: 'M12 3 4 21l8-5 8 5Z M12 3v13', title: 'Im Gelände' },
    { id: 'plan', label: 'Planung', icon: 'm4 16 12-12 4 4-12 12H4Z M13 7l4 4', title: 'Plan bearbeiten' },
    { id: 'briefing', label: 'Briefing', icon: 'm8 5 11 7-11 7Z', title: 'Briefing' },
    { id: 'maps', label: 'Karten', icon: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z M9 3v16 M15 5v16', title: 'Karten & Gebiete' },
    {
        id: 'project',
        label: 'Projekt',
        icon: 'M3 7h7l2-3h9v17H3Z M7 12h10 M7 16h7',
        title: 'Projekt & Zusammenarbeit',
    },
];
export default function WorkspaceShell({
    title,
    subtitle,
    status,
    map,
    panels,
    tab,
    onTab,
    blocked,
    quick,
    actions,
    alert,
    revealKey,
}: {
    title: string;
    subtitle: string;
    status: string;
    map: ReactNode;
    panels: Record<WorkspaceTab, ReactNode>;
    tab: WorkspaceTab;
    onTab: (tab: WorkspaceTab) => void;
    blocked?: boolean;
    quick?: ReactNode;
    actions?: ReactNode;
    alert?: ReactNode;
    revealKey?: string;
}) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (revealKey) {
            setOpen(true);
        }
    }, [revealKey]);
    useEffect(() => {
        // Programmatic workflow links also reveal their destination.
        if (tab !== 'field') {
            setOpen(true);
        }
    }, [tab]);
    const nav = useRef<HTMLElement>(null);
    useEffect(() => {
        const close = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !blocked && !(event.target as HTMLElement)?.closest('input,textarea,select')) {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', close);
        return () => window.removeEventListener('keydown', close);
    }, [blocked]);
    const active = tabs.find((item) => item.id === tab)!;
    return (
        <main className={`workspace ${open ? 'sheet-open' : 'sheet-closed'} mode-${tab}`}>
            <header className="workspace-header">
                <a className="workspace-brand" href="#" onClick={(event) => event.preventDefault()} aria-label="AS-TAC Kartenarbeitsplatz">
                    <BrandMark />
                    <span>
                        AS-TAC<small>FIELD SYSTEMS</small>
                    </span>
                </a>
                <div className="workspace-title">
                    <strong>{title}</strong>
                    <span>{subtitle}</span>
                </div>
                <span className="workspace-status">{status}</span>
                {actions}
                <Appearance />
            </header>
            {map}
            <div className="map-context">
                <span>{active.label}</span>
                <strong>{title}</strong>
                <small>{subtitle}</small>
            </div>
            <div className="map-quick-actions">
                {quick}
                <button className="map-action" aria-expanded={open} aria-controls="workspace-sheet" onClick={() => setOpen(!open)}>
                    {open ? 'Panel schliessen' : `${active.label} öffnen`}
                </button>
            </div>
            {alert && (
                <div className="workspace-alert" role="status">
                    {alert}
                </div>
            )}
            <aside id="workspace-sheet" className="workspace-sheet" aria-label={active.title} hidden={!open}>
                <div className="sheet-heading">
                    <div>
                        <small>{subtitle}</small>
                        <h1>{active.title}</h1>
                    </div>
                    <button aria-label="Panel schliessen" onClick={() => setOpen(false)}>
                        ×
                    </button>
                </div>
                <div
                    className="sheet-content"
                    onClick={(event) => {
                        const tool = (event.target as HTMLElement).closest('[data-draw-tool],[data-map-pick]');
                        if (tool) {
                            setOpen(false);
                        }
                    }}
                >
                    {tabs.map((item) => (
                        <div
                            key={item.id}
                            id={`workspace-${item.id}`}
                            role="tabpanel"
                            aria-labelledby={`tab-${item.id}`}
                            hidden={tab !== item.id}
                        >
                            {panels[item.id]}
                        </div>
                    ))}
                </div>
            </aside>
            <nav
                ref={nav}
                className="workspace-nav"
                role="tablist"
                aria-label="Arbeitsbereich"
                onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || blocked) {
                        return;
                    }
                    event.preventDefault();
                    const index = tabs.findIndex((item) => item.id === tab);
                    const next =
                        event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? tabs.length - 1
                              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                    onTab(tabs[next].id);
                    setOpen(true);
                    (nav.current?.querySelectorAll('[role=tab]')[next] as HTMLButtonElement)?.focus();
                }}
            >
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        id={`tab-${item.id}`}
                        role="tab"
                        aria-controls={`workspace-${item.id}`}
                        aria-selected={tab === item.id}
                        tabIndex={tab === item.id ? 0 : -1}
                        disabled={blocked && tab !== item.id}
                        onClick={() => {
                            if (tab === item.id) {
                                setOpen(true);
                            } else {
                                onTab(item.id);
                                setOpen(true);
                            }
                        }}
                    >
                        <span aria-hidden="true">
                            <svg
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.65"
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            >
                                <path d={item.icon} />
                            </svg>
                        </span>
                        {item.label}
                    </button>
                ))}
            </nav>
        </main>
    );
}
