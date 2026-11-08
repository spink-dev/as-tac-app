import { t } from '../../i18n';

/**
 * What to tell the user after a failed area download or install — a sentence, never a raw code,
 * and only «try again» when trying again can help.
 */
export function areaErrorText(message: string, kept = 0, total = 0): string {
    const wait = /^rate-limit:(\d+)$/.exec(message);
    if (wait) {
        return t('area.rateLimitWait', { s: wait[1] });
    }
    if (message === 'offline') {
        return t('area.needsNetwork');
    }
    if (message === 'area-too-large' || message === 'area-too-many-features') {
        return t('area.tooDetailed');
    }
    if (message === 'area-checksum') {
        return t('area.damaged');
    }
    // The server ran out of time or memory, or is rate-limiting: busy, not the connection.
    const cause = message === 'rate-limit' || message === 'overpass-incomplete' || /^HTTP 5\d\d$/.test(message) ? t('area.busy') : t('area.unstable');
    return kept > 0 ? `${cause} ${t('area.failedPartial', { done: kept, total })}` : `${cause} ${t('area.tryAgain')}`;
}
