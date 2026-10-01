import { useEffect, useRef, useState, type ReactNode } from 'react';
export type WorkspaceTab = 'field' | 'plan' | 'briefing' | 'maps' | 'project';
const tabs: { id: WorkspaceTab; label: string; icon: string; title: string }[] = [
    { id: 'field', label: 'Orientierung', icon: '◎', title: 'Im Gelände' },
    { id: 'plan', label: 'Planung', icon: '✎', title: 'Plan bearbeiten' },
    { id: 'briefing', label: 'Briefing', icon: '▷', title: 'Briefing' },
    { id: 'maps', label: 'Karten', icon: '▧', title: 'Karten & Gebiete' },
    { id: 'project', label: 'Projekt', icon: '▤', title: 'Projekt & Zusammenarbeit' },
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
                    <span className="brand-mark">A</span>
                    <span>
                        AS-TAC<small>KARTENARBEITSPLATZ</small>
                    </span>
                </a>
                <div className="workspace-title">
                    <strong>{title}</strong>
                    <span>{subtitle}</span>
                </div>
                <span className="workspace-status">{status}</span>
                {actions}
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
                        const tool = (event.target as HTMLElement).closest('[data-draw-tool]');
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
                        <span aria-hidden="true">{item.icon}</span>
                        {item.label}
                    </button>
                ))}
            </nav>
        </main>
    );
}
