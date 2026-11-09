import { useId } from 'react';
import { useT } from '../../i18n';
import { usePrefs } from '../../core/store/prefs';
import { BUNDLED_AREAS, byCountry, isBundled } from '../../core/areas/catalog';
import type { AreaMeta } from '../../core/areas/types';

/** Countries of the catalog in the display language («Deutschland · 8»). */
export function useCountries() {
    const locale = usePrefs((state) => state.locale);
    return byCountry(BUNDLED_AREAS, locale);
}

/** Country picker above a catalog list. */
export function CountrySelect({ value, onChange }: { value: string; onChange: (country: string) => void }) {
    const t = useT();
    const id = useId();
    const countries = useCountries();
    return (
        <div className="country-select">
            <label className="field__label" htmlFor={id}>{t('area.country')}</label>
            <select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value)} data-testid="area-country">
                {countries.map((group) => (
                    <option key={group.country} value={group.country}>{t('area.countryOption', { country: group.name, n: group.areas.length })}</option>
                ))}
            </select>
        </div>
    );
}

/**
 * `<option>`s for every area a plan can use: the device's own areas, then the catalog by country.
 * Labels name the place too («Bärenkopf … · Haut-du-Them-Château-Lambert»).
 */
export function AreaOptions({ installed }: { installed: readonly AreaMeta[] }) {
    const t = useT();
    const countries = useCountries();
    const own = installed.filter((area) => !isBundled(area.id));
    return (
        <>
            {own.length ? (
                <optgroup label={t('area.own')}>
                    {own.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                </optgroup>
            ) : null}
            {countries.map((group) => (
                <optgroup key={group.country} label={group.name}>
                    {group.areas.map((area) => <option key={area.id} value={area.id}>{`${area.name} · ${area.place}`}</option>)}
                </optgroup>
            ))}
        </>
    );
}

/** Display name of any area id: catalog field, an installed area, else the id itself. */
export function areaLabel(id: string, installed: readonly AreaMeta[]): string {
    return BUNDLED_AREAS.find((area) => area.id === id)?.name ?? installed.find((area) => area.id === id)?.name ?? id;
}
