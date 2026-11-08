import { ChevronLeft, Command, Compass, Presentation, Redo2, Search, Undo2, PencilRuler } from 'lucide-react';
import { useT } from '../../i18n';
import { useProject } from '../../core/store/project';
import { useUi, type Mode } from '../../core/store/ui';
import { closeProject } from '../../core/store/route';
import { useSaveState } from '../../core/storage/projects';
import { ICON, IconButton } from '../../ui/components';
import { AppearanceToggle } from '../../ui/Brand';
import { UpdateButton } from '../update/Update';
import { setMode } from './modes';
import { LiveBadge } from '../live/LiveBadge';

export function TopBar() {
    const t = useT();
    const name = useProject((state) => state.project?.name ?? '');
    const readOnly = useProject((state) => state.readOnly);
    const canUndo = useProject((state) => state.past.length > 0);
    const canRedo = useProject((state) => state.future.length > 0);
    const mode = useUi((state) => state.mode);
    const save = useSaveState((state) => state.state);
    const streamer = useUi((state) => state.streamer);

    const modes: { id: Mode; label: string; icon: typeof Compass }[] = [
        { id: 'plan', label: t('mode.plan'), icon: PencilRuler },
        { id: 'field', label: t('mode.field'), icon: Compass },
        { id: 'briefing', label: t('mode.briefing'), icon: Presentation },
    ];

    const saveText = readOnly === 'copy' ? t('save.readOnlyCopy') : readOnly === 'viewer' ? t('live.viewerLock') : save === 'saving' ? t('save.saving') : save === 'error' ? t('save.error') : t('save.saved');

    return (
        <header className="topbar" data-mode={mode}>
            <div className="topbar__left hud">
                <IconButton label={t('common.back')} tipPos="bottom" onClick={() => void closeProject()} data-testid="back">
                    <ChevronLeft {...ICON} />
                </IconButton>
                <div className="topbar__title">
                    <span className="topbar__name" title={streamer === 'off' ? name : undefined}>{streamer === 'off' ? name : 'AS-TAC'}</span>
                    <span className={`topbar__save ${save === 'error' ? 'is-error' : ''}`} aria-live="polite">{saveText}</span>
                </div>
            </div>

            <nav className="topbar__modes hud" aria-label={t('mode.label')}>
                {modes.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" className="mode-btn" aria-pressed={mode === id} onClick={() => setMode(id)} data-testid={`mode-${id}`}>
                        <Icon size={18} strokeWidth={1.9} />
                        <span className="mode-btn__label">{label}</span>
                    </button>
                ))}
            </nav>

            <div className="topbar__right hud">
                {streamer !== 'off' ? <span className="badge badge--warn">{t('streamer.title')}</span> : null}
                <LiveBadge />
                {mode === 'plan' && !readOnly ? (
                    <span className="topbar__undo">
                        <IconButton label={t('common.undo')} tipPos="bottom" disabled={!canUndo} onClick={() => {
                            const label = useProject.getState().undo();
                            if (label) {
                                useUi.getState().toast(`${t('common.undo')}: ${label}`);
                            }
                        }}>
                            <Undo2 {...ICON} />
                        </IconButton>
                        <IconButton label={t('common.redo')} tipPos="bottom" disabled={!canRedo} onClick={() => useProject.getState().redo()}>
                            <Redo2 {...ICON} />
                        </IconButton>
                    </span>
                ) : null}
                <IconButton label={t('common.search')} tipPos="bottom" onClick={() => useUi.getState().set({ palette: true })} className="topbar__search">
                    <span className="only-fine"><Command {...ICON} /></span>
                    <span className="only-coarse"><Search {...ICON} /></span>
                </IconButton>
                <UpdateButton />
                <AppearanceToggle />
            </div>
        </header>
    );
}
