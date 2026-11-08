import { useId } from 'react';
import { Copy, Crosshair, Lock, LockOpen, Navigation, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { useProject, mutate } from '../../core/store/project';
import { useUi } from '../../core/store/ui';
import { usePrefs } from '../../core/store/prefs';
import { Button, Empty, Field, ICON, Segmented, Swatches, Switch } from '../../ui/components';
import { canEdit, deleteSelection, duplicateSelection, patchElement, toggleLockSelection, typeLabel, MARKER_TYPES, ROUTE_STYLES, ZONE_CATEGORIES } from '../../core/actions';
import type { Element, LngLat, ObjectiveStatus, Project, ZonePattern } from '../../core/model/schema';
import { elementAnchor, elementColor, teamMap, zoneRing } from '../../map/planFeatures';
import { bearingDeg, distanceM, formatArea, formatBearing, formatDistance, formatLngLat, formatMils, pathLengthM, polygonAreaM2 } from '../../core/geo/geo';
import { toMgrs } from '../../core/geo/mgrs';
import { flyTo } from '../../map/MapView';
import { UNIT_SYMBOLS } from '../../map/icons';
import { MARKER_ICONS } from '../workspace/Tools';
import { NO_BRIEFING_PHASE } from '../../core/legacy/astac';

const PALETTE = ['#2f6fc4', '#c8393f', '#2f9d5e', '#e09a1a', '#7a4cc2', '#1f9aa6', '#e8c24d', '#14181b', '#f4f4f4'];
const STATUSES: ObjectiveStatus[] = ['unknown', 'enemy', 'contested', 'secured', 'lost'];

function Position({ p }: { p: LngLat }) {
    const format = usePrefs((state) => state.coordFormat);
    const text = format === 'mgrs' ? toMgrs(p, 5) : formatLngLat(p);
    return (
        <div className="kv">
            <span className="kv__k">{format === 'mgrs' ? 'MGRS' : 'WGS84'}</span>
            <button type="button" className="kv__v data copyable" title="Copy" onClick={() => void navigator.clipboard?.writeText(text)}>{text}</button>
        </div>
    );
}

function Stat({ k, v }: { k: string; v: string }) {
    return (
        <div className="kv">
            <span className="kv__k">{k}</span>
            <span className="kv__v num">{v}</span>
        </div>
    );
}

function PhaseChips({ element, project }: { element: Element; project: Project }) {
    const t = useT();
    if (project.phases.length === 0) {
        return null;
    }
    const ids = element.phaseIds ?? [];
    const all = ids.length === 0;
    const none = ids.length > 0 && ids.every((id) => !project.phases.some((p) => p.id === id));
    const toggle = (id: string) => {
        const current = all ? project.phases.map((p) => p.id) : ids.filter((x) => x !== NO_BRIEFING_PHASE);
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        const value = next.length === project.phases.length ? undefined : next.length === 0 ? [NO_BRIEFING_PHASE] : next;
        patchElement(element.id, { phaseIds: value }, t('inspector.phases'));
    };
    return (
        <div className="field">
            <span className="field__label">{t('inspector.phases')}</span>
            <div className="chip-row">
                <button type="button" className="chip" aria-pressed={all} onClick={() => patchElement(element.id, { phaseIds: undefined }, t('inspector.phases'))}>{t('inspector.allPhases')}</button>
                {project.phases.map((phase) => (
                    <button key={phase.id} type="button" className="chip" aria-pressed={!all && !none && ids.includes(phase.id)} onClick={() => toggle(phase.id)}>{phase.name}</button>
                ))}
            </div>
        </div>
    );
}

export function Inspector() {
    const t = useT();
    const project = useProject((state) => state.project);
    const selection = useUi((state) => state.selection);
    const mode = useUi((state) => state.mode);
    const bearingUnit = usePrefs((state) => state.bearingUnit);
    const labelId = useId();
    const notesId = useId();
    if (!project) {
        return null;
    }
    const editable = canEdit();
    if (selection.length === 0) {
        return <Empty>{t('inspector.empty')}</Empty>;
    }
    const elements = project.elements.filter((e) => selection.includes(e.id));
    const stroke = project.drawings.find((s) => s.id === selection[0]);
    if (elements.length === 0 && stroke && selection.length === 1) {
        return (
            <div className="stack">
                <h3 className="inspector__title">{t('tool.draw')}</h3>
                <fieldset className="plain" disabled={!editable}>
                    <Field label={t('common.color')}>
                        <Swatches value={stroke.color} colors={PALETTE} onChange={(color) => mutate(t('common.color'), (draft) => {
                            const target = draft.drawings.find((s) => s.id === stroke.id);
                            if (target) {
                                target.color = color;
                            }
                        })} />
                    </Field>
                </fieldset>
                {editable ? <Button variant="danger" onClick={() => deleteSelection()}><Trash2 {...ICON} /> {t('common.delete')}</Button> : null}
            </div>
        );
    }
    if (elements.length > 1) {
        const allLocked = elements.every((e) => e.locked);
        return (
            <div className="stack">
                <h3 className="inspector__title">{t('inspector.multi', { n: elements.length })}</h3>
                <fieldset className="plain stack" disabled={!editable}>
                    <Field label={t('common.team')}>
                        <select className="select" value="" onChange={(event) => {
                            const teamId = event.target.value === '__none' ? undefined : event.target.value;
                            mutate(t('common.team'), (draft) => {
                                for (const element of draft.elements) {
                                    if (selection.includes(element.id)) {
                                        element.teamId = teamId;
                                    }
                                }
                            });
                        }}>
                            <option value="" disabled>–</option>
                            <option value="__none">{t('common.none')}</option>
                            {project.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                        </select>
                    </Field>
                    <Field label={t('common.layer')}>
                        <select className="select" value="" onChange={(event) => mutate(t('common.layer'), (draft) => {
                            for (const element of draft.elements) {
                                if (selection.includes(element.id)) {
                                    element.layerId = event.target.value;
                                }
                            }
                        })}>
                            <option value="" disabled>–</option>
                            {project.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                        </select>
                    </Field>
                </fieldset>
                {editable ? (
                    <div className="row-gap">
                        <Button onClick={() => duplicateSelection()}><Copy size={18} /> {t('common.duplicate')}</Button>
                        <Button onClick={() => toggleLockSelection()}>{allLocked ? <LockOpen size={18} /> : <Lock size={18} />} {allLocked ? t('common.unlock') : t('common.lock')}</Button>
                        <Button variant="danger" onClick={() => deleteSelection()}><Trash2 size={18} /> {t('common.delete')}</Button>
                    </div>
                ) : null}
            </div>
        );
    }
    const element = elements[0];
    if (!element) {
        return <Empty>{t('inspector.empty')}</Empty>;
    }
    const teams = teamMap(project);
    const color = elementColor(element, teams);
    const key = (field: string) => `inspect:${element.id}:${field}`;
    const set = (patch: Partial<Element>, field: string) => patchElement(element.id, patch, t('common.edit'), key(field));
    const bearingText = (a: LngLat, b: LngLat) => (bearingUnit === 'mil' ? formatMils(bearingDeg(a, b)) : formatBearing(bearingDeg(a, b)));
    const layerLocked = project.layers.find((l) => l.id === (element.layerId ?? project.layers[0]?.id))?.locked;
    const MarkerIcon = element.kind === 'marker' ? MARKER_ICONS[element.type] : null;

    return (
        <div className="stack inspector" data-testid="inspector">
            <div className="inspector__head">
                <span className="inspector__swatch" style={{ background: color }}>{MarkerIcon ? <MarkerIcon size={16} color="#fff" /> : null}</span>
                <h3 className="inspector__title">{typeLabel(element)}</h3>
                {element.locked || layerLocked ? <span className="badge"><Lock size={12} /> {t('common.locked')}</span> : null}
                {element.anchorImageId ? <span className="badge" title={t('inspector.boundImage')}>⌖</span> : null}
            </div>
            <fieldset className="plain stack" disabled={!editable || Boolean(element.locked) || Boolean(layerLocked)}>
                {element.kind === 'text' ? (
                    <>
                        <Field label={t('inspector.text')} htmlFor={labelId}>
                            <textarea id={labelId} className="textarea" rows={2} value={element.text} autoFocus={element.text === t('tool.text')} onFocus={(event) => element.text === t('tool.text') && event.target.select()} onChange={(event) => set({ text: event.target.value }, 'text')} />
                        </Field>
                        <Field label={`${t('inspector.size')} · ${element.size ?? 14}`}>
                            <input type="range" className="range" min={9} max={40} value={element.size ?? 14} onChange={(event) => set({ size: Number(event.target.value) }, 'size')} />
                        </Field>
                    </>
                ) : (
                    <Field label={t('common.label')} htmlFor={labelId}>
                        <input id={labelId} className="input" value={element.label ?? ''} onChange={(event) => set({ label: event.target.value || undefined }, 'label')} />
                    </Field>
                )}

                {element.kind === 'marker' ? (
                    <>
                        <Field label={t('inspector.type')}>
                            <div className="chip-row">
                                {MARKER_TYPES.map((type) => {
                                    const Icon = MARKER_ICONS[type];
                                    return (
                                        <button key={type} type="button" className="chip" aria-pressed={element.type === type} onClick={() => set({ type } as Partial<Element>, 'type')}>
                                            <Icon size={14} /> {t(`marker.${type}`)}
                                        </button>
                                    );
                                })}
                            </div>
                        </Field>
                        {element.type === 'unit' || element.type === 'enemy' ? (
                            <Field label={t('teams.symbol')}>
                                <div className="chip-row">
                                    <button type="button" className="chip" aria-pressed={!element.symbol} onClick={() => set({ symbol: undefined } as Partial<Element>, 'symbol')}>{t('common.team')}</button>
                                    {UNIT_SYMBOLS.map((symbol) => (
                                        <button key={symbol} type="button" className="chip" aria-pressed={element.symbol === symbol} onClick={() => set({ symbol } as Partial<Element>, 'symbol')}>{symbol}</button>
                                    ))}
                                </div>
                            </Field>
                        ) : null}
                        {element.type === 'objective' ? (
                            <Field label={t('inspector.objectiveStatus')}>
                                <Segmented block value={element.objectiveStatus ?? 'unknown'} onChange={(value) => set({ objectiveStatus: value === 'unknown' ? undefined : value } as Partial<Element>, 'status')} options={STATUSES.map((s) => ({ value: s, label: t(`objective.${s}`) }))} />
                            </Field>
                        ) : null}
                    </>
                ) : null}

                {element.kind === 'route' ? (
                    <>
                        <Field label={t('inspector.style')}>
                            <Segmented block value={element.style} onChange={(style) => set({ style } as Partial<Element>, 'style')} options={ROUTE_STYLES.map((s) => ({ value: s, label: t(`route.${s}`) }))} />
                        </Field>
                        <Switch checked={element.arrow} onChange={(arrow) => set({ arrow } as Partial<Element>, 'arrow')}>{t('inspector.arrow')}</Switch>
                        <Field label={`${t('inspector.width')} · ${element.width ?? 3}`}>
                            <input type="range" className="range" min={1} max={10} value={element.width ?? 3} onChange={(event) => set({ width: Number(event.target.value) } as Partial<Element>, 'width')} />
                        </Field>
                    </>
                ) : null}

                {element.kind === 'zone' ? (
                    <>
                        <Field label={t('inspector.type')}>
                            <div className="chip-row">
                                {ZONE_CATEGORIES.map((category) => (
                                    <button key={category} type="button" className="chip" aria-pressed={element.category === category} onClick={() => set({ category } as Partial<Element>, 'category')}>{t(`zone.${category}`)}</button>
                                ))}
                            </div>
                        </Field>
                        <Field label={t('inspector.pattern')}>
                            <Segmented block value={element.pattern ?? 'auto'} onChange={(pattern) => set({ pattern: pattern === 'auto' ? undefined : pattern as ZonePattern } as Partial<Element>, 'pattern')} options={[
                                { value: 'auto', label: 'Auto' }, { value: 'solid', label: t('pattern.solid') }, { value: 'hatch', label: t('pattern.hatch') }, { value: 'cross', label: t('pattern.cross') }, { value: 'none', label: t('pattern.none') },
                            ]} />
                        </Field>
                        <Field label={`${t('inspector.fill')} · ${Math.round(element.fillOpacity * 100)} %`}>
                            <input type="range" className="range" min={0} max={60} value={Math.round(element.fillOpacity * 100)} onChange={(event) => set({ fillOpacity: Number(event.target.value) / 100 } as Partial<Element>, 'fill')} />
                        </Field>
                        {element.shape.type === 'circle' ? (
                            <Field label={`${t('inspector.radius')} (m)`}>
                                <input type="number" className="input num" min={1} max={20000} value={Math.round(element.shape.radiusM)} onChange={(event) => {
                                    const radiusM = Number(event.target.value);
                                    if (radiusM > 0 && element.shape.type === 'circle') {
                                        set({ shape: { ...element.shape, radiusM } } as Partial<Element>, 'radius');
                                    }
                                }} />
                            </Field>
                        ) : null}
                        {element.category === 'objective' ? (
                            <Field label={t('inspector.objectiveStatus')}>
                                <Segmented block value={element.objectiveStatus ?? 'unknown'} onChange={(value) => set({ objectiveStatus: value === 'unknown' ? undefined : value } as Partial<Element>, 'status')} options={STATUSES.map((s) => ({ value: s, label: t(`objective.${s}`) }))} />
                            </Field>
                        ) : null}
                    </>
                ) : null}

                {element.kind !== 'text' && element.kind !== 'bearing' ? (
                    <Field label={t('common.team')}>
                        <select className="select" value={element.teamId ?? ''} onChange={(event) => set({ teamId: event.target.value || undefined }, 'team')}>
                            <option value="">{t('common.none')}</option>
                            {project.teams.map((team) => <option key={team.id} value={team.id}>{team.unitNumber ? `${team.unitNumber} · ` : ''}{team.name}</option>)}
                        </select>
                    </Field>
                ) : null}

                <Field label={t('common.color')}>
                    <Swatches value={element.color ?? color} colors={PALETTE} onChange={(value) => set({ color: value }, 'color')} />
                </Field>

                <Field label={t('common.layer')}>
                    <select className="select" value={element.layerId ?? project.layers[0]?.id} onChange={(event) => set({ layerId: event.target.value }, 'layer')}>
                        {project.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}{layer.locked ? ' 🔒' : ''}</option>)}
                    </select>
                </Field>

                <PhaseChips element={element} project={project} />

                <Field label={t('common.notes')} htmlFor={notesId}>
                    <textarea id={notesId} className="textarea" rows={3} value={element.notes ?? ''} onChange={(event) => set({ notes: event.target.value || undefined }, 'notes')} />
                </Field>
            </fieldset>

            <div className="kv-list">
                <Position p={elementAnchor(element)} />
                {element.kind === 'route' ? <Stat k={t('inspector.length')} v={formatDistance(pathLengthM(element.points))} /> : null}
                {element.kind === 'zone' ? <Stat k={t('inspector.area')} v={formatArea(polygonAreaM2(zoneRing(element)))} /> : null}
                {element.kind === 'bearing' ? (
                    <>
                        <Stat k={t('inspector.bearing')} v={bearingText(element.start, element.end)} />
                        <Stat k={t('inspector.distance')} v={formatDistance(distanceM(element.start, element.end))} />
                    </>
                ) : null}
            </div>
            {element.kind === 'route' && element.points.length > 2 ? (
                <details className="legs">
                    <summary>{t('inspector.legs')} ({element.points.length - 1})</summary>
                    <ol className="legs__list num">
                        {element.points.slice(1).map((p, i) => (
                            <li key={i}>{bearingText(element.points[i], p)} · {formatDistance(distanceM(element.points[i], p))}</li>
                        ))}
                    </ol>
                </details>
            ) : null}

            <div className="row-gap">
                <Button small onClick={() => flyTo({ center: elementAnchor(element), zoom: 17 })}><Crosshair size={16} /> {t('inspector.zoomTo')}</Button>
                {mode === 'field' ? (
                    <Button small variant="primary" onClick={() => useUi.getState().set({ navTargetId: element.id })}><Navigation size={16} /> {t('inspector.navigate')}</Button>
                ) : null}
                {editable ? (
                    <>
                        <Button small onClick={() => duplicateSelection()}><Copy size={16} /> {t('common.duplicate')}</Button>
                        <Button small onClick={() => toggleLockSelection()}>{element.locked ? <LockOpen size={16} /> : <Lock size={16} />} {element.locked ? t('common.unlock') : t('common.lock')}</Button>
                        <Button small variant="danger" onClick={() => deleteSelection()} disabled={Boolean(element.locked)}><Trash2 size={16} /> {t('common.delete')}</Button>
                    </>
                ) : null}
            </div>
        </div>
    );
}
