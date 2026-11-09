import { useState } from 'react';
import { ArrowDown, ArrowUp, Camera, ChevronDown, Crosshair, Plus, Presentation, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { useProject, mutate } from '../../core/store/project';
import { useUi, toast } from '../../core/store/ui';
import { Button, Empty, Field, IconButton, NameInput } from '../../ui/components';
import { canEdit, toastUndoable } from '../../core/actions';
import { uid } from '../../core/model/factory';
import { LIMITS, MAX, type Phase, type Project } from '../../core/model/schema';
import { currentCamera, flyTo, mapRef } from '../../map/MapView';
import { visibleInPhase } from '../../map/planFeatures';
import { NO_BRIEFING_PHASE } from '../../core/legacy/astac';
import { registerPanel } from '../panels/registry';
import { setMode } from '../workspace/modes';
import { goToPhase } from './briefing';

function objectCount(project: Project, phaseId: string): number {
    return project.elements.filter((element) => {
        const ids = element.phaseIds;
        return !ids?.includes(NO_BRIEFING_PHASE) && visibleInPhase(ids, phaseId);
    }).length;
}

/** Remove a phase id from a phase list without changing what stays visible elsewhere. */
function withoutPhase(ids: string[] | undefined, phaseId: string): string[] | undefined {
    if (!ids || !ids.includes(phaseId)) {
        return ids;
    }
    const next = ids.filter((id) => id !== phaseId);
    // Only in the deleted phase: hidden in every remaining phase (an empty list would mean "all").
    return next.length === 0 ? [NO_BRIEFING_PHASE] : next;
}

function PhaseRow({ phase, index, project }: { phase: Phase; index: number; project: Project }) {
    const t = useT();
    const [open, setOpen] = useState(false);
    const editable = canEdit();
    const patch = (value: Partial<Phase>, field: string) => mutate(t('common.edit'), (draft) => {
        const target = draft.phases.find((p) => p.id === phase.id);
        if (target) {
            Object.assign(target, value);
            for (const [k, v] of Object.entries(value)) {
                if (v === undefined) {
                    delete (target as Record<string, unknown>)[k];
                }
            }
        }
    }, { key: `phase:${phase.id}:${field}` });
    const move = (delta: number) => mutate(t('layers.moveUp'), (draft) => {
        const from = draft.phases.findIndex((p) => p.id === phase.id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= draft.phases.length) {
            return;
        }
        const [item] = draft.phases.splice(from, 1);
        draft.phases.splice(to, 0, item);
    });
    const remove = () => {
        const ok = mutate(t('common.delete'), (draft) => {
            draft.phases = draft.phases.filter((p) => p.id !== phase.id);
            // Kept briefing ink that belonged only to this phase goes with it (it could never show again).
            draft.drawings = draft.drawings.filter((stroke) => !(stroke.briefingOnly && stroke.phaseIds?.length === 1 && stroke.phaseIds[0] === phase.id));
            for (const item of [...draft.elements, ...draft.drawings]) {
                const next = withoutPhase(item.phaseIds, phase.id);
                if (next !== item.phaseIds) {
                    item.phaseIds = next;
                }
            }
        });
        if (ok) {
            const ui = useUi.getState();
            if (ui.phaseIndex >= project.phases.length - 1) {
                ui.set({ phaseIndex: Math.max(0, project.phases.length - 2) });
            }
            toastUndoable(t('inspector.deleted', { name: phase.name }));
        }
    };
    return (
        <li className="phase-row">
            <div className="phase-row__head">
                <span className="phase-row__index num" aria-hidden>{index + 1}</span>
                <button type="button" className="list-row phase-row__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
                    <span className="list-row__main">
                        <span className="list-row__title">{phase.name}</span>
                        <span className="list-row__meta">
                            {[phase.start ? `${phase.start}${phase.end ? `–${phase.end}` : ''}` : '', t('layers.elements', { n: objectCount(project, phase.id) }), phase.camera ? '' : t('phases.noView')].filter(Boolean).join(' · ')}
                        </span>
                    </span>
                    <ChevronDown size={16} className={open ? 'rot-180' : ''} />
                </button>
                <IconButton small label={t('phases.show')} onClick={() => {
                    if (phase.camera) {
                        flyTo(phase.camera);
                    }
                    if (useUi.getState().mode === 'briefing') {
                        goToPhase(index);
                    }
                }} disabled={!phase.camera}><Crosshair size={16} /></IconButton>
            </div>
            {open ? (
                <fieldset className="plain stack phase-row__body" disabled={!editable}>
                    <Field label={t('common.name')}>
                        <NameInput maxLength={MAX.phaseName} value={phase.name} onCommit={(name) => patch({ name }, 'name')} />
                    </Field>
                    <div className="field-row">
                        <Field label={`${t('phases.time')} (${t('phases.from')})`}>
                            <input className="input num" maxLength={40} placeholder="09:00" value={phase.start ?? ''} onChange={(event) => patch({ start: event.target.value || undefined }, 'start')} />
                        </Field>
                        <Field label={t('phases.to')}>
                            <input className="input num" maxLength={40} placeholder="10:30" value={phase.end ?? ''} onChange={(event) => patch({ end: event.target.value || undefined }, 'end')} />
                        </Field>
                    </div>
                    <Field label={t('common.notes')} hint={t('phases.notesHint')}>
                        <textarea className="textarea" rows={3} maxLength={MAX.longText} value={phase.notes ?? ''} onChange={(event) => patch({ notes: event.target.value || undefined }, 'notes')} />
                    </Field>
                    {editable ? (
                        <div className="row-gap">
                            <Button small onClick={() => {
                                const map = mapRef.current;
                                if (map && patch({ camera: currentCamera(map) }, 'camera')) {
                                    toast(t('phases.viewSaved'), { tone: 'ok' });
                                }
                            }}><Camera size={16} /> {t('phases.captureView')}</Button>
                            <span className="spacer" />
                            <IconButton small label={t('layers.moveUp')} onClick={() => move(-1)} disabled={index === 0}><ArrowUp size={16} /></IconButton>
                            <IconButton small label={t('layers.moveDown')} onClick={() => move(1)} disabled={index === project.phases.length - 1}><ArrowDown size={16} /></IconButton>
                            <IconButton small label={t('common.delete')} onClick={remove}><Trash2 size={16} /></IconButton>
                        </div>
                    ) : null}
                </fieldset>
            ) : null}
        </li>
    );
}

/** Phases structure the briefing: each has a view, a time, notes and its own objects. */
export function PhasesPanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    useProject((state) => state.readOnly);
    useUi((state) => state.mode);
    if (!project) {
        return null;
    }
    const editable = canEdit();
    const full = project.phases.length >= LIMITS.phases;
    const add = () => {
        const map = mapRef.current;
        const phase: Phase = { id: uid('ph'), name: t('phases.newName', { n: project.phases.length + 1 }), camera: map ? currentCamera(map) : undefined };
        mutate(t('phases.add'), (draft) => {
            draft.phases.push(phase);
        });
    };
    return (
        <div className="stack">
            <div className="row-gap">
                {editable ? <Button small variant="ghost" onClick={add} disabled={full} title={full ? t('phases.limit', { n: LIMITS.phases }) : undefined}><Plus size={16} /> {t('phases.add')}</Button> : null}
                <span className="spacer" />
                <Button small variant="primary" onClick={() => setMode('briefing')} data-testid="start-briefing"><Presentation size={16} /> {t('phases.start')}</Button>
            </div>
            {project.phases.length === 0 ? <Empty>{t('phases.empty')}</Empty> : (
                <ol className="phase-list">
                    {project.phases.map((phase, index) => <PhaseRow key={phase.id} phase={phase} index={index} project={project} />)}
                </ol>
            )}
            {project.phases.length > 0 ? <p className="field__hint">{t('phases.assignHint')}</p> : null}
        </div>
    );
}

registerPanel('phases', 'panel.phases', PhasesPanel);
