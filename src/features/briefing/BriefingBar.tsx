import { useState } from 'react';
import { ChevronLeft, ChevronRight, Eraser, PenLine, Radio, Trash2, X } from 'lucide-react';
import { useT } from '../../i18n';
import { DRAW_COLORS, useUi } from '../../core/store/ui';
import { useProject, mutate } from '../../core/store/project';
import { armTool } from '../../core/actions';
import { Button, ICON, IconButton, Swatches } from '../../ui/components';
import { visibleInPhase } from '../../map/planFeatures';
import { goToPhase, stepPhase } from './briefing';
import { setMode } from '../workspace/modes';
import { useLive } from '../../core/live/state';
import { myClientId, setFollowing, setLeading } from '../../core/live/session';

/**
 * Presentation controls: phase navigation, the phase's notes and a temporary pen.
 * Briefing ink is session-only unless «Keep briefing drawings» is on (then `briefingOnly`).
 */
export function BriefingBar() {
    const t = useT();
    const mode = useUi((state) => state.mode);
    const index = useUi((state) => state.phaseIndex);
    const tool = useUi((state) => state.tool);
    const drawColor = useUi((state) => state.drawColor);
    const sessionInk = useUi((state) => state.briefingInk.length);
    const phases = useProject((state) => state.project?.phases ?? []);
    const keep = useProject((state) => state.project?.settings.keepBriefingInk ?? false);
    const drawings = useProject((state) => state.project?.drawings);
    const [notesOpen, setNotesOpen] = useState(true);
    const liveStatus = useLive((state) => state.status);
    const liveRole = useLive((state) => state.role);
    const leaderId = useLive((state) => state.leaderId);
    const following = useLive((state) => state.following);
    const leader = useLive((state) => state.presence.find((p) => p.clientId === state.leaderId));
    if (mode !== 'briefing') {
        return null;
    }
    const count = phases.length;
    const current = count > 0 ? phases[Math.min(index, count - 1)] : null;
    const persistedInk = keep && drawings ? drawings.filter((s) => s.briefingOnly && visibleInPhase(s.phaseIds, current?.id ?? null)) : [];
    const inkCount = sessionInk + persistedInk.length;
    const pen = tool === 'draw';
    const clearInk = () => {
        useUi.getState().set({ briefingInk: [] });
        if (persistedInk.length > 0) {
            const ids = new Set(persistedInk.map((s) => s.id));
            mutate(t('briefing.clearInk'), (draft) => {
                draft.drawings = draft.drawings.filter((s) => !ids.has(s.id));
            });
        }
    };

    return (
        <div className="briefingbar hud" role="region" aria-label={t('mode.briefing')} data-testid="briefingbar">
            <div className="briefingbar__main">
                <IconButton label={t('common.back')} onClick={() => stepPhase(-1)} disabled={!current || index <= 0}><ChevronLeft {...ICON} /></IconButton>
                <div className="briefingbar__title" aria-live="polite">
                    {current ? (
                        <>
                            <span className="briefingbar__index num">{t('briefing.phase', { i: index + 1, n: count })}{current.start ? ` · ${current.start}${current.end ? `–${current.end}` : ''}` : ''}</span>
                            <strong className="briefingbar__name">{current.name}</strong>
                        </>
                    ) : <strong className="briefingbar__name">{t('briefing.noPhases')}</strong>}
                </div>
                <IconButton label={t('common.next')} onClick={() => stepPhase(1)} disabled={!current || index >= count - 1}><ChevronRight {...ICON} /></IconButton>
            </div>
            {count > 1 ? (
                <div className="briefingbar__steps" role="group" aria-label={t('panel.phases')}>
                    {phases.map((phase, i) => (
                        <button key={phase.id} type="button" className="briefingbar__step" aria-current={i === index ? 'step' : undefined} aria-label={phase.name} title={phase.name} onClick={() => goToPhase(i)} />
                    ))}
                </div>
            ) : null}
            {current?.notes ? (
                <div className="briefingbar__notes">
                    <button type="button" className="disclosure" aria-expanded={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>{t('common.notes')}</button>
                    {notesOpen ? <p className="briefingbar__text">{current.notes}</p> : null}
                </div>
            ) : null}
            <div className="briefingbar__tools">
                <Button variant={pen ? 'primary' : 'secondary'} aria-pressed={pen} onClick={() => (pen ? useUi.getState().setTool('select') : armTool('draw'))}>
                    <PenLine size={18} /> {t('briefing.ink')}
                </Button>
                {pen ? <Swatches value={DRAW_COLORS[drawColor]} colors={DRAW_COLORS} allowCustom={false} onChange={(color) => useUi.getState().set({ drawColor: Math.max(0, DRAW_COLORS.indexOf(color)) })} /> : null}
                {inkCount > 0 ? (
                    <>
                        <IconButton label={t('tool.erase')} pressed={tool === 'erase'} onClick={() => (tool === 'erase' ? useUi.getState().setTool('select') : armTool('erase'))}><Eraser {...ICON} /></IconButton>
                        <IconButton label={t('briefing.clearInk')} onClick={clearInk}><Trash2 {...ICON} /></IconButton>
                    </>
                ) : null}
                <span className="spacer" />
                {liveStatus === 'online' && (liveRole === 'owner' || liveRole === 'admin') && (!leaderId || leaderId === myClientId()) ? (
                    <Button variant={leaderId === myClientId() ? 'primary' : 'secondary'} aria-pressed={leaderId === myClientId()} onClick={() => setLeading(leaderId !== myClientId())} data-testid="lead">
                        <Radio size={18} /> {t('briefing.lead')}
                    </Button>
                ) : null}
                {liveStatus === 'online' && leaderId && leaderId !== myClientId() ? (
                    <Button variant={following ? 'primary' : 'secondary'} aria-pressed={following} onClick={() => setFollowing(!following)} data-testid="follow">
                        <Radio size={18} /> {following && leader ? t('briefing.following', { name: leader.name }) : t('briefing.follow')}
                    </Button>
                ) : null}
                <Button variant="ghost" onClick={() => {
                    if (leaderId === myClientId()) {
                        setLeading(false);
                    }
                    setFollowing(false);
                    setMode('plan');
                }}><X size={18} /> {t('briefing.end')}</Button>
            </div>
            {!keep && inkCount > 0 ? <p className="field__hint">{t('briefing.keepInkHint')}</p> : null}
        </div>
    );
}
