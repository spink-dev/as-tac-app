import { usePrefs, type Locale } from '../core/store/prefs';
import { S, type StringKey } from './strings';

export type { StringKey };

export function translate(locale: Locale, key: StringKey, vars?: Record<string, string | number>): string {
    const entry = S[key];
    let text: string = entry ? entry[locale === 'en' ? 1 : 0] : key;
    if (vars) {
        for (const [name, value] of Object.entries(vars)) {
            text = text.replaceAll(`{${name}}`, String(value));
        }
    }
    return text;
}

export function t(key: StringKey, vars?: Record<string, string | number>): string {
    return translate(usePrefs.getState().locale, key, vars);
}

export function useT() {
    const locale = usePrefs((state) => state.locale);
    return (key: StringKey, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export function relativeTime(iso: string, locale: Locale): string {
    const diff = (Date.now() - Date.parse(iso)) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale === 'en' ? 'en' : 'de-CH', { numeric: 'auto' });
    if (diff < 60) {
        return rtf.format(-Math.round(diff), 'second');
    }
    if (diff < 3600) {
        return rtf.format(-Math.round(diff / 60), 'minute');
    }
    if (diff < 86400) {
        return rtf.format(-Math.round(diff / 3600), 'hour');
    }
    if (diff < 86400 * 30) {
        return rtf.format(-Math.round(diff / 86400), 'day');
    }
    return new Date(iso).toLocaleDateString(locale === 'en' ? 'en' : 'de-CH');
}

export function formatDateTime(iso: string, locale: Locale): string {
    return new Date(iso).toLocaleString(locale === 'en' ? 'en' : 'de-CH', { dateStyle: 'short', timeStyle: 'short' });
}

export function formatTime(iso: string, locale: Locale): string {
    return new Date(iso).toLocaleTimeString(locale === 'en' ? 'en' : 'de-CH', { hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
