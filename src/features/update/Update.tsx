import { ArrowUpCircle, RefreshCw, Sparkles } from 'lucide-react';
import { useT, formatDateTime, relativeTime, type StringKey } from '../../i18n';
import { applyUpdate, checkForUpdate, usePwa, type UpdateStatus } from '../../core/pwa';
import { usePrefs } from '../../core/store/prefs';
import { useDialogs, showDialog } from '../../core/store/dialogs';
import { mayAutoDownload } from '../../core/net';
import { Button, Dialog, ICON, IconButton } from '../../ui/components';
import { APP_VERSION, BUILD, type BuildInfo } from '../../version';
import { RELEASES } from '../../core/releases';

type T = (key: StringKey, vars?: Record<string, string | number>) => string;

/** States in which the app offers to switch versions. */
const OFFERS: UpdateStatus[] = ['available', 'downloading', 'ready', 'applying', 'reload'];

/** "1.0.0-alpha.3"; a rebuild of the running version is told apart by its commit or date. */
function buildLabel(build: BuildInfo, locale: 'de' | 'en'): string {
    if (build.version !== APP_VERSION) {
        return build.version;
    }
    return `${build.version} · ${build.commit || (build.date ? formatDateTime(build.date, locale) : '')}`;
}

function statusText(t: T, status: UpdateStatus, available: BuildInfo | null, lastCheck: number | null, locale: 'de' | 'en'): string {
    const v = available ? buildLabel(available, locale) : null;
    switch (status) {
        case 'checking':
            return t('update.checking');
        case 'current':
            return lastCheck ? `${t('update.current')} ${t('update.lastCheck', { when: relativeTime(new Date(lastCheck).toISOString(), locale) })}` : t('update.current');
        case 'available':
            return v ? t('update.available', { v }) : t('update.availableGeneric');
        case 'downloading':
            return v ? t('update.downloading', { v }) : t('update.downloadingGeneric');
        case 'ready':
            return v ? t('update.ready', { v }) : t('update.readyGeneric');
        case 'applying':
            return t('update.applying');
        case 'reload':
            return t('update.reloadNeeded');
        case 'offline':
            return t('update.offline');
        case 'failed':
            return t('update.failed');
        default:
            return '';
    }
}

function UpdateAction({ small }: { small?: boolean }) {
    const t = useT();
    const status = usePwa((state) => state.status);
    if (status === 'reload') {
        return <Button small={small} variant="primary" onClick={() => void applyUpdate()} data-testid="update-apply"><RefreshCw size={16} /> {t('update.reload')}</Button>;
    }
    if (OFFERS.includes(status)) {
        const working = status === 'downloading' || status === 'applying';
        return (
            <Button small={small} variant="primary" disabled={working} aria-busy={working} onClick={() => void applyUpdate()} data-testid="update-apply">
                <ArrowUpCircle size={16} /> {t('update.apply')}
            </Button>
        );
    }
    return (
        <Button small={small} disabled={status === 'checking'} aria-busy={status === 'checking'} onClick={() => void checkForUpdate(true)} data-testid="update-check">
            <RefreshCw size={16} /> {t('update.check')}
        </Button>
    );
}

/** Version, build, update state and actions: start screen («Dieses Gerät») and plan settings. */
export function AppInfo() {
    const t = useT();
    const locale = usePrefs((state) => state.locale);
    const { status, available, lastCheck } = usePwa();
    const text = statusText(t, status, available, lastCheck, locale);
    const saver = status === 'available' && !mayAutoDownload();
    return (
        <div className="app-info stack">
            <div className="app-info__version">
                <span className="num" data-testid="app-version">{t('update.version', { v: APP_VERSION })}</span>
                {BUILD.commit || BUILD.date ? (
                    <span className="field__hint num">{t('update.build', { build: [BUILD.commit, BUILD.date ? formatDateTime(BUILD.date, locale) : ''].filter(Boolean).join(' · ') })}</span>
                ) : null}
            </div>
            <p className="field__hint" aria-live="polite" data-testid="update-status">
                {text}{saver ? ` ${t('update.dataSaver')}` : ''}
            </p>
            <div className="row-gap wrap">
                <UpdateAction small />
                <Button small variant="ghost" onClick={() => showDialog('whatsNew')}><Sparkles size={16} /> {t('update.whatsNew')}</Button>
            </div>
        </div>
    );
}

/** Start screen: a new version is there (or another tab switched to one). */
export function UpdateBanner() {
    const t = useT();
    const locale = usePrefs((state) => state.locale);
    const { status, available, lastCheck } = usePwa();
    if (!OFFERS.includes(status)) {
        return null;
    }
    return (
        <div className={`notice ${status === 'reload' ? 'notice--warn' : 'notice--ok'} update-banner`} role="status" data-testid="update-banner">
            <ArrowUpCircle size={18} aria-hidden="true" />
            <span className="spacer">{statusText(t, status, available, lastCheck, locale)}</span>
            <UpdateAction small />
        </div>
    );
}

/** Plan view: one quiet button while an update waits; one tap saves and switches. */
export function UpdateButton() {
    const t = useT();
    const locale = usePrefs((state) => state.locale);
    const { status, available, lastCheck } = usePwa();
    if (status !== 'ready' && status !== 'reload' && status !== 'available') {
        return null;
    }
    const label = `${statusText(t, status, available, lastCheck, locale)} ${status === 'reload' ? t('update.reload') : t('update.apply')}`;
    return (
        <IconButton label={label} tipPos="bottom" className="update-dot" onClick={() => void applyUpdate()} data-testid="update-topbar">
            <ArrowUpCircle {...ICON} />
        </IconButton>
    );
}

export function WhatsNewDialog() {
    const t = useT();
    const locale = usePrefs((state) => state.locale);
    const open = useDialogs((state) => state.open === 'whatsNew');
    const hide = useDialogs((state) => state.hide);
    const index = locale === 'en' ? 1 : 0;
    return (
        <Dialog open={open} onClose={hide} title={t('update.whatsNew')}>
            <div className="stack">
                {RELEASES.map((release) => (
                    <section key={release.version} className="section">
                        <div className="section__title num">
                            {release.version}{release.version === APP_VERSION ? ` · ${t('update.installed')}` : ''}
                        </div>
                        <ul className="release-notes">
                            {release.items.map((item) => <li key={item[0]}>{item[index]}</li>)}
                        </ul>
                    </section>
                ))}
                <p className="field__hint">{t('update.changelog')}</p>
            </div>
        </Dialog>
    );
}
