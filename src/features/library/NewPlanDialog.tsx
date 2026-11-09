import { useEffect, useId, useRef, useState } from 'react';
import { Download, Map as MapIcon, WifiOff } from 'lucide-react';
import { areaErrorText, isNetworkError } from '../areas/areaErrors';
import { useT, formatBytes } from '../../i18n';
import { Button, Dialog, Field, ICON } from '../../ui/components';
import { useDialogs } from '../../core/store/dialogs';
import { bundledArea, ensureArea, isBundled, listAreas, areaCenter } from '../../core/areas/store';
import { defaultCountry, START_FIELD, startChoice, startField } from '../../core/areas/catalog';
import { CountrySelect, useCountries } from '../areas/AreaCatalog';
import { usePrefs } from '../../core/store/prefs';
import type { AreaMeta } from '../../core/areas/types';
import { createProject } from '../../core/model/factory';
import { createAndOpen } from '../../core/store/route';
import { MAHLWINKEL_EVENTS, buildMahlwinkelProject } from '../../core/templates/mahlwinkel';
import { toast } from '../../core/store/ui';

export function NewPlanDialog() {
    const t = useT();
    const open = useDialogs((state) => state.open === 'newPlan');
    const payload = useDialogs((state) => state.payload as { areaId?: string; country?: string } | null);
    const hide = useDialogs((state) => state.hide);
    const show = useDialogs((state) => state.show);
    const nameId = useId();
    const [name, setName] = useState('');
    const locale = usePrefs((state) => state.locale);
    // The user's country and its start field; refined once the installed areas are known.
    const [country, setCountry] = useState(() => defaultCountry());
    const [areaId, setAreaId] = useState<string>(() => startChoice(country, locale, new Set(), true).areaId);
    const [template, setTemplate] = useState<string>('');
    const [installed, setInstalled] = useState<AreaMeta[] | null>(null);
    const countries = useCountries();
    const [busy, setBusy] = useState<number | null>(null);
    // The chosen field could not be loaded for lack of network: said here, with Mahlwinkel offered
    // (a toast's button would sit behind the modal dialog).
    const [networkProblem, setNetworkProblem] = useState<string | null>(null);
    const creating = useRef(false);
    // Until someone chooses an area or a country, the dialog keeps to the default choice.
    const picked = useRef(false);
    // Per opening: the installed areas have been looked at once; a country asked for by «Feld wählen».
    const refined = useRef(false);
    const pendingCountry = useRef<string | null>(null);
    const installedIds = (list: AreaMeta[] | null) => new Set((list ?? []).map((area) => area.id));

    useEffect(() => {
        if (open) {
            setInstalled(null);
            void listAreas().then(setInstalled);
            setName('');
            setTemplate('');
            setBusy(null);
            setNetworkProblem(null);
            refined.current = false;
            pendingCountry.current = null;
            if (payload?.areaId) {
                picked.current = true;
                setAreaId(payload.areaId);
                setCountry(defaultCountry(payload.areaId));
            } else if (payload?.country) {
                // «Feld wählen»: a field of that country, whatever was chosen last time.
                picked.current = true;
                pendingCountry.current = payload.country;
                setCountry(payload.country);
                const first = startField(payload.country, locale, installedIds(installed));
                if (first) {
                    chooseArea(first.id);
                }
            } else if (picked.current) {
                setCountry(defaultCountry(areaId));
            }
        }
        // Only when the dialog opens: the chosen area is kept between openings.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, payload]);

    useEffect(() => {
        if (!open || !installed) {
            return;
        }
        const ids = installedIds(installed);
        const first = !refined.current;
        refined.current = true;
        if (first && pendingCountry.current) {
            // «Feld wählen»: now that the installed areas are known, a field of it on the device first.
            const field = startField(pendingCountry.current, locale, ids);
            pendingCountry.current = null;
            if (field && field.id !== areaId) {
                chooseArea(field.id);
            }
            return;
        }
        // The default: the user's country, a field of it already on the device first; offline with
        // none there, Mahlwinkel (it ships with the app). Also after a remembered own area was
        // removed, instead of an unseen, missing choice, and, once per opening, offline instead of a
        // remembered field that is not on the device.
        const missing = areaId !== '__none' && !isBundled(areaId) && !ids.has(areaId);
        const unusable = first && !navigator.onLine && isBundled(areaId) && areaId !== START_FIELD && !ids.has(areaId);
        if (!picked.current || missing || unusable) {
            const choice = startChoice(defaultCountry(), locale, ids, navigator.onLine);
            setCountry(choice.country);
            if (choice.areaId !== areaId) {
                chooseArea(choice.areaId);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, installed, areaId]);

    const here = installed ?? [];
    const fields = (countries.find((group) => group.country === country)?.areas ?? []).map((area) => ({
        id: area.id,
        name: area.name,
        meta: `${area.place} · ${here.some((i) => i.id === area.id) ? t('area.installed') : t('area.onFirstUse', { size: formatBytes(area.bytes) })}`,
    }));
    const own = here.filter((area) => !isBundled(area.id)).map((area) => ({ id: area.id, name: area.name, meta: `${t('area.installed')} · ${formatBytes(area.byteSize)}` }));
    const ownLabel = useId();
    const templates = areaId === 'mahlwinkel' ? MAHLWINKEL_EVENTS : [];

    function chooseArea(id: string) {
        setAreaId(id);
        setTemplate('');
        setNetworkProblem(null);
    }

    function pickArea(id: string) {
        picked.current = true;
        chooseArea(id);
    }

    /**
     * Another country. A field chosen in the old one gives way to the new country's start field, so
     * the choice stays visible; an own area or «Ohne Grundkarte» stays chosen (both are always shown).
     */
    function pickCountry(next: string) {
        picked.current = true;
        setCountry(next);
        const first = startField(next, locale, installedIds(installed));
        const chosen = bundledArea(areaId);
        if (first && chosen && chosen.country !== next) {
            chooseArea(first.id);
        }
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
            // A field that needs the network while there is none (or none that carries data):
            // Mahlwinkel ships with the app and always works.
            if (isNetworkError(error) && isBundled(areaId) && areaId !== START_FIELD) {
                setNetworkProblem(areaErrorText(error));
            } else {
                toast(areaErrorText(error), { tone: 'danger' });
            }
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
                    <Button variant="primary" onClick={() => void create()} disabled={busy !== null || installed === null} data-testid="create-plan">
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
                <CountrySelect value={country} onChange={pickCountry} />
                <div className="choice-list" role="radiogroup" aria-label={t('new.area')} data-testid="new-plan-areas">
                    {fields.map((area) => (
                        <button key={area.id} type="button" role="radio" aria-checked={areaId === area.id} className="choice" onClick={() => pickArea(area.id)}>
                            <MapIcon {...ICON} />
                            <span className="choice__main">
                                <span className="choice__title">{area.name}</span>
                                <span className="choice__meta">{area.meta}</span>
                            </span>
                        </button>
                    ))}
                    {own.length ? <div className="choice-list__label" id={ownLabel} aria-hidden="true">{t('area.own')}</div> : null}
                    {own.map((area) => (
                        <button key={area.id} type="button" role="radio" aria-checked={areaId === area.id} aria-describedby={ownLabel} className="choice" onClick={() => pickArea(area.id)}>
                            <MapIcon {...ICON} />
                            <span className="choice__main">
                                <span className="choice__title">{area.name}</span>
                                <span className="choice__meta">{area.meta}</span>
                            </span>
                        </button>
                    ))}
                    <button type="button" role="radio" aria-checked={areaId === '__none'} className="choice" onClick={() => pickArea('__none')}>
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
                {networkProblem ? (
                    <div className="notice notice--warn" role="alert" data-testid="new-plan-network">
                        <WifiOff {...ICON} />
                        <span className="notice__body">{networkProblem}</span>
                        <Button small onClick={() => {
                            picked.current = true;
                            setCountry(defaultCountry(START_FIELD));
                            chooseArea(START_FIELD);
                        }}>
                            {t('new.useStartField')}
                        </Button>
                    </div>
                ) : null}
            </div>
            {templates.length > 0 ? (
                <div className="field">
                    <span className="field__label">{t('new.template')}</span>
                    <div className="chip-row" role="radiogroup" aria-label={t('new.template')}>
                        <button type="button" role="radio" className="chip" aria-checked={template === ''} onClick={() => setTemplate('')}>{t('new.templateNone')}</button>
                        {templates.map((event) => (
                            <button key={event.id} type="button" role="radio" className="chip" aria-checked={template === event.id} title={t('new.templateSummary', { buildings: event.counts.buildings, hq: event.counts.hq, zones: event.counts.zones })} onClick={() => setTemplate(event.id)}>
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
