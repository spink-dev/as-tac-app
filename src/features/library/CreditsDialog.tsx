import { useT } from '../../i18n';
import { useDialogs } from '../../core/store/dialogs';
import { Dialog } from '../../ui/components';
import { FIELDMAPS_CREDIT } from '../../core/templates/mahlwinkel';
import { APP_VERSION } from '../../version';

/** Sources and licences: OSM/ODbL attribution, FieldMaps data, open-source dependencies. */
export function CreditsDialog() {
    const t = useT();
    const open = useDialogs((state) => state.open === 'credits');
    const hide = useDialogs((state) => state.hide);
    const base = import.meta.env.BASE_URL;
    return (
        <Dialog open={open} onClose={hide} title={t('library.credits')}>
            <div className="stack credits">
                <section className="section">
                    <div className="section__title">{t('credits.maps')}</div>
                    <p>{t('credits.osm')}</p>
                    <p><a href={`${base}licenses/ODbL-1.0.txt`} target="_blank" rel="noopener">Open Database License 1.0</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a></p>
                </section>
                <section className="section">
                    <div className="section__title">{t('credits.events')}</div>
                    <p>{t('credits.fieldmaps')}</p>
                    <p className="field__hint data">{FIELDMAPS_CREDIT}</p>
                    <p className="field__hint">{t('credits.noThirdParty')}</p>
                </section>
                <section className="section">
                    <div className="section__title">{t('credits.software')}</div>
                    <p><a href={`${base}licenses/dependencies.txt`} target="_blank" rel="noopener">{t('credits.dependencies')}</a></p>
                    <p className="field__hint num">AS-TAC {APP_VERSION}</p>
                </section>
            </div>
        </Dialog>
    );
}
