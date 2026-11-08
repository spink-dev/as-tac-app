import { Keyboard } from 'lucide-react';
import { useT } from '../../i18n';
import { useProject, mutate } from '../../core/store/project';
import { usePrefs } from '../../core/store/prefs';
import { useUi } from '../../core/store/ui';
import { Button, Field, NameInput, Segmented, Switch } from '../../ui/components';
import { showDialog } from '../../core/store/dialogs';
import { canEdit, toastStreamer } from '../../core/actions';
import { MAX } from '../../core/model/schema';
import { AppInfo } from '../update/Update';

export function SettingsPanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    useProject((state) => state.readOnly);
    useUi((state) => state.mode);
    const prefs = usePrefs();
    const streamer = useUi((state) => state.streamer);
    if (!project) {
        return null;
    }
    const setting = <K extends keyof typeof project.settings>(key: K, value: (typeof project.settings)[K]) => mutate(t('panel.settings'), (draft) => {
        draft.settings[key] = value;
    }, { key: `setting:${String(key)}` });
    return (
        <div className="stack">
            <section className="section">
                <div className="section__title">{t('settings.plan')}</div>
                <fieldset className="plain stack" disabled={!canEdit()}>
                    <Field label={t('settings.name')}>
                        <NameInput maxLength={MAX.projectName} value={project.name} onCommit={(name) => mutate(t('common.rename'), (draft) => {
                            draft.name = name;
                        }, { key: 'project-name' })} />
                    </Field>
                    <Switch checked={project.settings.returnToSelect} onChange={(v) => setting('returnToSelect', v)}>{t('settings.returnToSelect')}</Switch>
                    <Switch checked={project.settings.directManipulation} onChange={(v) => setting('directManipulation', v)}>{t('settings.directManipulation')}</Switch>
                    <Switch checked={project.settings.legLabels} onChange={(v) => setting('legLabels', v)}>{t('settings.legLabels')}</Switch>
                    <Switch checked={project.settings.keepBriefingInk} onChange={(v) => setting('keepBriefingInk', v)}>{t('briefing.keepInk')}</Switch>
                    <p className="field__hint">{t('briefing.keepInkHint')}</p>
                    <Field label={`${t('settings.unitScale')} · ${Math.round(project.settings.unitScale * 100)} %`}>
                        <input type="range" className="range" min={75} max={250} step={5} value={Math.round(project.settings.unitScale * 100)} onChange={(event) => setting('unitScale', Number(event.target.value) / 100)} />
                    </Field>
                </fieldset>
            </section>
            <section className="section">
                <div className="section__title">{t('streamer.title')}</div>
                <Segmented block value={streamer} onChange={(value) => {
                    // Jump straight to the chosen profile; privacy overlay only, nothing else changes.
                    useUi.getState().set({ streamer: value, streamerInk: value === 'off' ? [] : useUi.getState().streamerInk });
                    toastStreamer(value);
                }} options={[{ value: 'off', label: t('streamer.off') }, { value: 'field', label: t('mode.field') }, { value: 'public', label: t('streamer.public') }]} />
                <p className="field__hint">{t('streamer.hint')}</p>
            </section>
            <section className="section">
                <div className="section__title">{t('settings.device')}</div>
                <Field label={t('settings.language')}>
                    <Segmented block value={prefs.locale} onChange={(locale) => prefs.set({ locale })} options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} />
                </Field>
                <Field label={t('settings.bearing')}>
                    <Segmented block value={prefs.bearingUnit} onChange={(bearingUnit) => prefs.set({ bearingUnit })} options={[{ value: 'deg', label: t('settings.degrees') }, { value: 'mil', label: t('settings.mils') }]} />
                </Field>
                <Field label={t('settings.coords')}>
                    <Segmented block value={prefs.coordFormat} onChange={(coordFormat) => prefs.set({ coordFormat })} options={[{ value: 'mgrs', label: 'MGRS' }, { value: 'latlng', label: 'WGS84' }]} />
                </Field>
                <Switch checked={prefs.redMapFilter} onChange={(redMapFilter) => prefs.set({ redMapFilter })}>{t('settings.redFilter')}</Switch>
                <Field label={t('settings.media')}>
                    <Segmented block value={prefs.mediaDownload} onChange={(mediaDownload) => prefs.set({ mediaDownload })} options={[
                        { value: 'auto', label: t('settings.mediaAuto') }, { value: 'wifi', label: t('settings.mediaWifi') }, { value: 'manual', label: t('settings.mediaManual') },
                    ]} />
                    <span className="field__hint">{t('settings.mediaHint')}</span>
                </Field>
                <Field label={t('live.displayName')}>
                    <input className="input" value={prefs.displayName} maxLength={40} onChange={(event) => prefs.set({ displayName: event.target.value })} />
                </Field>
                <Button onClick={() => showDialog('shortcuts')}><Keyboard size={18} /> {t('settings.shortcuts')}</Button>
            </section>
            <section className="section">
                <div className="section__title">{t('update.title')}</div>
                <AppInfo />
            </section>
        </div>
    );
}
