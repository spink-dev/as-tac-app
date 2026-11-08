import { Check, RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import { useUi } from '../../core/store/ui';
import { useProject, mutate } from '../../core/store/project';
import { useAlign } from '../../map/align';
import { Button, Switch } from '../../ui/components';
import { boundCount } from '../../core/images';

/** Step-by-step control-point alignment: image point, then the same place on the map. */
export function AlignBar() {
    const t = useT();
    const id = useUi((state) => state.imageEditId);
    const image = useProject((state) => state.project?.images.find((i) => i.id === id) ?? null);
    const project = useProject((state) => state.project);
    const pending = useAlign((state) => state.pendingPx);
    const moveBound = useAlign((state) => state.moveBound);
    if (!id || !image || !project) {
        return null;
    }
    const pairs = image.controlPoints?.length ?? 0;
    const bound = boundCount(project, image.id);
    return (
        <div className="alignbar hud" role="region" aria-label={t('align.title')} data-testid="alignbar">
            <div className="alignbar__head">
                <strong>{t('align.title')}</strong>
                <span className="muted">· {image.name}</span>
                <span className="spacer" />
                <span className="badge num">{t('align.pairs', { n: pairs })}</span>
                {image.fit?.rmsM !== undefined && image.fit.method !== 'manual' ? <span className="badge badge--ok num">± {image.fit.rmsM} m</span> : null}
            </div>
            <p className="alignbar__step" aria-live="polite">
                <span className="step-dot">{pending ? 2 : 1}</span>
                {pending ? t('align.pickMap') : t('align.pickImage')}
            </p>
            <div className="alignbar__row">
                <label className="alignbar__opacity">
                    <span className="field__label">{t('common.opacity')}</span>
                    <input type="range" className="range" min={15} max={100} value={Math.round(image.opacity * 100)} onChange={(event) => mutate(t('common.opacity'), (draft) => {
                        const target = draft.images.find((i) => i.id === image.id);
                        if (target) {
                            target.opacity = Number(event.target.value) / 100;
                        }
                    }, { key: `img-op:${image.id}` })} />
                </label>
                {bound > 0 ? <Switch checked={moveBound} onChange={(value) => useAlign.setState({ moveBound: value })}>{t('align.moveElements')} ({bound})</Switch> : null}
            </div>
            <div className="alignbar__row">
                <Button small variant="ghost" disabled={pairs === 0 && !pending} onClick={() => {
                    useAlign.setState({ pendingPx: null });
                    mutate(t('align.reset'), (draft) => {
                        const target = draft.images.find((i) => i.id === image.id);
                        if (target) {
                            delete target.controlPoints;
                        }
                    });
                }}><RotateCcw size={16} /> {t('align.reset')}</Button>
                <span className="spacer" />
                <Button small variant="primary" onClick={() => useUi.getState().set({ imageEditId: null })} data-testid="align-done"><Check size={16} /> {t('common.done')}</Button>
            </div>
            <p className="field__hint">{t('align.lead')}</p>
        </div>
    );
}
