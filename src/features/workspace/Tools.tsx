import { useState } from 'react';
import {
    Building2, Check, Circle, Compass as CompassIcon, Cross, Crosshair, Diamond, Eraser, Flag, FlagTriangleRight, Hexagon, MapPin, MoreHorizontal,
    MousePointer2, PanelRight, Pencil, RotateCcw, Route, Ruler, Shield, Type, TriangleAlert, Undo2, X,
} from 'lucide-react';
import { useT } from '../../i18n';
import { useUi, DRAW_COLORS, type ToolId } from '../../core/store/ui';
import { useProject } from '../../core/store/project';
import { usePrefs } from '../../core/store/prefs';
import { MARKER_TYPES, ROUTE_STYLES, ZONE_CATEGORIES, armTool, canEdit } from '../../core/actions';
import { shortcutHint } from '../../core/shortcuts/registry';
import { cancelDraft, finishDraft, removeLastDraftPoint } from '../../map/interaction';
import { ICON, IconButton } from '../../ui/components';
import { MARKER_COLORS, ROUTE_COLORS, ZONE_COLORS } from '../../map/planFeatures';
import type { MarkerType } from '../../core/model/schema';
import { pathLengthM, formatDistance } from '../../core/geo/geo';
import { alignActive } from '../../map/align';

const TOOL_ICONS: Record<ToolId, typeof MapPin> = {
    select: MousePointer2, marker: MapPin, route: Route, zone: Hexagon, text: Type, draw: Pencil, erase: Eraser, bearing: CompassIcon, measure: Ruler,
};
const TOOL_ORDER: ToolId[] = ['select', 'marker', 'route', 'zone', 'text', 'draw', 'erase', 'bearing', 'measure'];
const DOCK_PRIMARY: ToolId[] = ['select', 'marker', 'route', 'zone', 'draw'];

export const MARKER_ICONS: Record<MarkerType, typeof MapPin> = {
    unit: Shield, enemy: Diamond, objective: Crosshair, medic: Cross, respawn: RotateCcw, danger: TriangleAlert, hq: Flag, custom: MapPin, poi: Building2, flag: FlagTriangleRight,
};

function useToolLabel() {
    const t = useT();
    const keybinds = usePrefs((state) => state.keybinds);
    return (tool: ToolId) => {
        const hint = shortcutHint(`tool.${tool}`, keybinds);
        return hint ? `${t(`tool.${tool}`)} (${hint})` : t(`tool.${tool}`);
    };
}

/** Desktop: vertical rail. Phones: bottom dock with the five most used tools. */
export function ToolRail() {
    const t = useT();
    const tool = useUi((state) => state.tool);
    const mode = useUi((state) => state.mode);
    const readOnly = useProject((state) => state.readOnly);
    const panel = useUi((state) => state.panel);
    const sheet = useUi((state) => state.sheet);
    const label = useToolLabel();
    const [more, setMore] = useState(false);
    if (mode !== 'plan' || readOnly) {
        return null;
    }
    const button = (id: ToolId) => {
        const Icon = TOOL_ICONS[id];
        return (
            <IconButton key={id} label={label(id)} pressed={tool === id} onPointerDown={(event) => event.preventDefault()} onClick={() => {
                setMore(false);
                armTool(id);
            }} data-testid={`tool-${id}`}>
                <Icon {...ICON} />
            </IconButton>
        );
    };
    return (
        <>
            <nav className="rail hud" aria-label={t('mode.plan')}>
                {TOOL_ORDER.map(button)}
            </nav>
            <nav className="dock hud" aria-label={t('mode.plan')}>
                {DOCK_PRIMARY.map(button)}
                <div className="dock__more">
                    <IconButton label={t('common.more')} pressed={more || !DOCK_PRIMARY.includes(tool)} onClick={() => setMore(!more)} aria-expanded={more}>
                        <MoreHorizontal {...ICON} />
                    </IconButton>
                    {more ? (
                        <div className="menu dock__menu" role="menu">
                            {TOOL_ORDER.filter((id) => !DOCK_PRIMARY.includes(id)).map((id) => {
                                const Icon = TOOL_ICONS[id];
                                return (
                                    <button key={id} type="button" role="menuitem" className="menu__item" aria-current={tool === id} onClick={() => {
                                        setMore(false);
                                        armTool(id);
                                    }}>
                                        <Icon size={18} /> {t(`tool.${id}`)}
                                    </button>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
                <span className="dock__sep" />
                <IconButton label={t('panel.layers')} pressed={panel !== null && sheet !== 'closed'} onClick={() => useUi.getState().openPanel(panel && panel !== 'inspector' ? panel : 'layers')}>
                    <PanelRight {...ICON} />
                </IconButton>
            </nav>
        </>
    );
}

/** Subtype choices of the active tool, active team and ink settings. */
export function ContextBar() {
    const t = useT();
    const ui = useUi();
    const teams = useProject((state) => state.project?.teams ?? []);
    if (ui.mode !== 'plan' || !canEdit() || ui.tool === 'select') {
        return null;
    }
    const teamPicker = (ui.tool === 'marker' && ['unit', 'hq', 'enemy'].includes(ui.markerType)) || (ui.tool === 'route' && ui.routeStyle !== 'boundary');
    return (
        <div className="ctxbar hud" role="toolbar" aria-label={t(`tool.${ui.tool}`)}>
            {ui.tool === 'marker' ? MARKER_TYPES.map((type) => {
                const Icon = MARKER_ICONS[type];
                return (
                    <button key={type} type="button" className="ctx-chip" aria-pressed={ui.markerType === type} onClick={() => ui.set({ markerType: type })} title={t(`marker.${type}`)}>
                        <Icon size={16} strokeWidth={2} color={MARKER_COLORS[type]} />
                        <span>{t(`marker.${type}`)}</span>
                    </button>
                );
            }) : null}
            {ui.tool === 'route' ? ROUTE_STYLES.map((style) => (
                <button key={style} type="button" className="ctx-chip" aria-pressed={ui.routeStyle === style} onClick={() => ui.set({ routeStyle: style })}>
                    <span className={`line-swatch line-swatch--${style}`} style={{ color: ROUTE_COLORS[style] }} />
                    <span>{t(`route.${style}`)}</span>
                </button>
            )) : null}
            {ui.tool === 'zone' ? (
                <>
                    <button type="button" className="ctx-chip" aria-pressed={ui.zoneShape === 'polygon'} onClick={() => ui.set({ zoneShape: 'polygon', draft: null })}>
                        <Hexagon size={16} /> <span>{t('zone.polygon')}</span>
                    </button>
                    <button type="button" className="ctx-chip" aria-pressed={ui.zoneShape === 'circle'} onClick={() => ui.set({ zoneShape: 'circle', draft: null })}>
                        <Circle size={16} /> <span>{t('zone.circle')}</span>
                    </button>
                    <span className="ctxbar__sep" />
                    {ZONE_CATEGORIES.map((category) => (
                        <button key={category} type="button" className="ctx-chip" aria-pressed={ui.zoneCategory === category} onClick={() => ui.set({ zoneCategory: category })}>
                            <span className="dot" style={{ ['--dot' as string]: ZONE_COLORS[category] }} />
                            <span>{t(`zone.${category}`)}</span>
                        </button>
                    ))}
                </>
            ) : null}
            {ui.tool === 'draw' ? (
                <>
                    {DRAW_COLORS.map((color, i) => (
                        <button key={color} type="button" className="swatch" style={{ ['--swatch' as string]: color }} aria-label={color} aria-pressed={ui.drawColor === i} onClick={() => ui.set({ drawColor: i })} />
                    ))}
                    <span className="ctxbar__sep" />
                    {[2, 4, 8].map((width) => (
                        <button key={width} type="button" className="ctx-chip" aria-pressed={ui.drawWidth === width} onClick={() => ui.set({ drawWidth: width })} aria-label={`${width}px`}>
                            <span className="stroke-dot" style={{ width: width + 4, height: width + 4 }} />
                        </button>
                    ))}
                </>
            ) : null}
            {ui.tool === 'erase' ? [14, 22, 36].map((px) => (
                <button key={px} type="button" className="ctx-chip" aria-pressed={ui.eraserPx === px} onClick={() => ui.set({ eraserPx: px })} aria-label={`${px}px`}>
                    <span className="stroke-dot stroke-dot--ring" style={{ width: px * 0.7, height: px * 0.7 }} />
                </button>
            )) : null}
            {teamPicker ? (
                <>
                    <span className="ctxbar__sep" />
                    <label className="ctx-select">
                        <span className="sr-only">{t('common.team')}</span>
                        <span className="dot" style={{ ['--dot' as string]: teams.find((team) => team.id === ui.activeTeamId)?.color ?? 'transparent' }} />
                        <select value={ui.activeTeamId ?? ''} onChange={(event) => ui.set({ activeTeamId: event.target.value || null })}>
                            <option value="">{t('common.team')}: –</option>
                            {teams.map((team) => <option key={team.id} value={team.id}>{team.unitNumber ? `${team.unitNumber} · ` : ''}{team.name}</option>)}
                        </select>
                    </label>
                </>
            ) : null}
        </div>
    );
}

/** One line telling the user what the active tool expects next. */
export function HintBar() {
    const t = useT();
    const tool = useUi((state) => state.tool);
    const draft = useUi((state) => state.draft);
    const mode = useUi((state) => state.mode);
    const markerType = useUi((state) => state.markerType);
    const zoneShape = useUi((state) => state.zoneShape);
    const readOnly = useProject((state) => state.readOnly);
    const aligning = useUi((state) => state.imageEditId);
    useUi((state) => state.streamer);
    if (mode !== 'plan' || readOnly || (aligning && alignActive())) {
        return null;
    }
    const started = Boolean(draft && draft.points.length > 0);
    let text: string;
    switch (tool) {
        case 'select':
            text = t('hint.select');
            break;
        case 'marker':
            text = t('hint.marker', { type: t(`marker.${markerType}`) });
            break;
        case 'route':
            text = started ? t('hint.route.more') : t('hint.route.first');
            break;
        case 'zone':
            text = zoneShape === 'circle' ? t('hint.zone.circle') : started ? t('hint.zone.more') : t('hint.zone.first');
            break;
        default:
            text = t(`hint.${tool}` as 'hint.text');
    }
    return <div className="hintbar" role="status" aria-live="polite">{text}</div>;
}

export function DraftBar() {
    const t = useT();
    const draft = useUi((state) => state.draft);
    const measure = useUi((state) => state.measure);
    if (measure && !draft) {
        return (
            <div className="draftbar hud">
                <span className="draftbar__info num"><Ruler size={16} /> {formatDistance(pathLengthM(measure))}</span>
                <IconButton label={t('common.close')} onClick={() => cancelDraft()}><X {...ICON} /></IconButton>
            </div>
        );
    }
    if (!draft || draft.tool === 'draw' || draft.points.length === 0) {
        return null;
    }
    const canFinish = (draft.tool === 'route' && draft.points.length >= 2) || (draft.tool === 'zone' && draft.points.length >= 3) || (draft.tool === 'measure' && draft.points.length >= 2);
    return (
        <div className="draftbar hud" data-testid="draftbar">
            <IconButton label={t('draft.cancel')} onPointerDown={(event) => event.preventDefault()} onClick={() => cancelDraft()}><X {...ICON} /></IconButton>
            <IconButton label={t('draft.undoPoint')} onPointerDown={(event) => event.preventDefault()} onClick={() => removeLastDraftPoint()}><Undo2 {...ICON} /></IconButton>
            <span className="draftbar__info num">{draft.points.length}</span>
            {canFinish ? (
                <button type="button" className="btn btn--primary btn--sm" onPointerDown={(event) => event.preventDefault()} onClick={() => finishDraft()} data-testid="finish-draft">
                    <Check size={18} /> {t('draft.finish')}
                </button>
            ) : null}
        </div>
    );
}
