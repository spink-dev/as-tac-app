import { useEffect, useId, useRef, useState } from 'react';
import { Download, Map as MapIcon } from 'lucide-react';
import { areaErrorText } from '../areas/areaErrors';
import { useT, formatBytes } from '../../i18n';
import { Button, Dialog, Field, ICON } from '../../ui/components';
import { useDialogs } from '../../core/store/dialogs';
import { BUNDLED_AREAS, ensureArea, listAreas, areaCenter } from '../../core/areas/store';
import type { AreaMeta } from '../../core/areas/types';
import { createProject } from '../../core/model/factory';
import { createAndOpen } from '../../core/store/route';
import { MAHLWINKEL_EVENTS, buildMahlwinkelProject } from '../../core/templates/mahlwinkel';
import { toast } from '../../core/store/ui';

export function NewPlanDialog() {
    const t = useT();
    const open = useDialogs((state) => state.open === 'newPlan');
    const payload = useDialogs((state) => state.payload as { areaId?: string } | null);
    const hide = useDialogs((state) => state.hide);
    const show = useDialogs((state) => state.show);
    const nameId = useId();
    const [name, setName] = useState('');
    const [areaId, setAreaId] = useState<string>('mahlwinkel');
    const [template, setTemplate] = useState<string>('');
    const [installed, setInstalled] = useState<AreaMeta[]>([]);
    const [busy, setBusy] = useState<number | null>(null);
    const creating = useRef(false);

    useEffect(() => {
        if (open) {
            void listAreas().then(setInstalled);
            setName('');
            setTemplate('');
            setBusy(null);
            if (payload?.areaId) {
                setAreaId(payload.areaId);
            }
        }
    }, [open, payload]);

    const areas = [
        ...BUNDLED_AREAS.map((area) => ({ id: area.id, name: area.name, meta: `${t('area.bundled')} · ${formatBytes(area.approxBytes)}` })),
        ...installed.filter((area) => !BUNDLED_AREAS.some((b) => b.id === area.id)).map((area) => ({ id: area.id, name: area.name, meta: `${t('area.installed')} · ${formatBytes(area.byteSize)}` })),
    ];
    const templates = areaId === 'mahlwinkel' ? MAHLWINKEL_EVENTS : [];

    function chooseArea(id: string) {
        setAreaId(id);
        setTemplate('');
    }

    async function create() {
        if (creating.current) {
            return;
        }
        creating.current = true;
        try {
            setBusy(0);
            if (areaId !== '__none') {
                await ensureArea(areaId, (fraction) => setBusy(fraction ?? 0));
            }
            const area = areaId === '__none' ? undefined : (await listAreas()).find((candidate) => candidate.id === areaId);
            const project = template && areaId === 'mahlwinkel'
                ? buildMahlwinkelProject(template, name.trim() || undefined)
                : createProject({ name: name || t('library.new'), areaId: areaId === '__none' ? null : areaId, center: area ? areaCenter(area.bounds) : undefined, zoom: 14 });
            hide();
            await createAndOpen(project);
        } catch (error) {
            setBusy(null);
            toast(areaErrorText(error instanceof Error ? error.message : String(error)), { tone: 'danger' });
        } finally {
            creating.current = false;
        }
    }

    return (
        <Dialog
            open={open}
            onClose={hide}
            title={t('new.title')}
            labelledBy="new-plan-title"
            footer={(
                <>
                    <Button variant="ghost" onClick={hide}>{t('common.cancel')}</Button>
                    <Button variant="primary" onClick={() => void create()} disabled={busy !== null} data-testid="create-plan">
                        {busy !== null ? t('new.installing') : t('new.create')}
                    </Button>
                </>
            )}
        >
            <Field label={t('new.name')} htmlFor={nameId}>
                <input
                    id={nameId}
                    className="input"
                    value={name}
                    placeholder={t('new.namePlaceholder')}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            void create();
                        }
                    }}
                    autoFocus
                />
            </Field>
            <div className="field">
                <span className="field__label">{t('new.area')}</span>
                <div className="choice-list" role="radiogroup" aria-label={t('new.area')}>
                    {areas.map((area) => (
                        <button key={area.id} type="button" role="radio" aria-checked={areaId === area.id} className="choice" onClick={() => chooseArea(area.id)}>
                            <MapIcon {...ICON} />
                            <span className="choice__main">
                                <span className="choice__title">{area.name}</span>
                                <span className="choice__meta">{area.meta}</span>
                            </span>
                        </button>
                    ))}
                    <button type="button" role="radio" aria-checked={areaId === '__none'} className="choice" onClick={() => chooseArea('__none')}>
                        <span className="choice__main">
                            <span className="choice__title">{t('new.noArea')}</span>
                        </span>
                    </button>
                </div>
                <button type="button" className="choice choice--action choice--standalone" onClick={() => show('areaDownload', { returnTo: 'newPlan' })}>
                    <Download {...ICON} />
                    <span className="choice__main">
                        <span className="choice__title">{t('new.downloadArea')}</span>
                    </span>
                </button>
                <span className="field__hint">{t('new.areaHint')}</span>
            </div>
            {templates.length > 0 ? (
                <div className="field">
                    <span className="field__label">{t('new.template')}</span>
                    <div className="chip-row" role="radiogroup" aria-label={t('new.template')}>
                        <button type="button" role="radio" className="chip" aria-checked={template === ''} onClick={() => setTemplate('')}>{t('new.templateNone')}</button>
                        {templates.map((event) => (
                            <button key={event.id} type="button" role="radio" className="chip" aria-checked={template === event.id} title={event.summary} onClick={() => setTemplate(event.id)}>
                                {event.name}
                            </button>
                        ))}
                    </div>
                    <span className="field__hint">FieldMaps · @rwolffgang</span>
                </div>
            ) : null}
            {busy !== null ? (
                <div className="progress" role="progressbar" aria-label={t('new.installing')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy * 100)}>
                    <div className="progress__bar" style={{ transform: `scaleX(${Math.max(0.04, busy)})` }} />
                </div>
            ) : null}
        </Dialog>
    );
}
