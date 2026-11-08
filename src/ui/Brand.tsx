import { Moon, Sun, SunDim } from 'lucide-react';
import { APPEARANCE_ORDER, usePrefs } from '../core/store/prefs';
import { useT } from '../i18n';
import { ICON, IconButton } from './components';

/** AS-TAC mark: two directed A segments (identity from 0.5). */
export function BrandMark({ size = 24 }: { size?: number }) {
    return (
        <svg width={size} height={(size * 40) / 48} viewBox="0 0 48 40" aria-hidden="true" className="brand-mark">
            <path d="M5 36 22 4h8l-9 17h12l5 9H16l-3 6Z" fill="currentColor" />
            <path d="m32 7 12 29H33l-4-9h8L27 7Z" fill="currentColor" />
        </svg>
    );
}

export function AppearanceToggle() {
    const t = useT();
    const appearance = usePrefs((state) => state.appearance);
    const set = usePrefs((state) => state.set);
    const next = APPEARANCE_ORDER[(APPEARANCE_ORDER.indexOf(appearance) + 1) % APPEARANCE_ORDER.length];
    const label = `${t('appearance.toggle')}: ${t(`appearance.${appearance}`)} → ${t(`appearance.${next}`)}`;
    return (
        <IconButton label={label} tipPos="left" onClick={() => set({ appearance: next })} data-testid="appearance">
            {appearance === 'day' ? <Sun {...ICON} /> : appearance === 'dark' ? <Moon {...ICON} /> : <SunDim {...ICON} />}
        </IconButton>
    );
}
