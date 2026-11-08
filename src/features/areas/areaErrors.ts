import { t } from '../../i18n';

/** Errors that come from the connection (as opposed to the device, the data or a server). */
const NETWORK = /^(stalled|download|timeout)$|failed to fetch|load failed|networkerror|network error|aborted/i;

/**
 * What to tell the user after a failed area download, install or plan creation — a sentence,
 * never a raw code, and only «try again» when trying again can help.
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
    if (/quota|QuotaExceeded|storage.*full/i.test(message)) {
        return t('area.storageFull');
    }
    let cause: string;
    if (message === 'rate-limit' || message === 'overpass-incomplete') {
        cause = t('area.busy');
    } else if (/^HTTP 5\d\d$/.test(message)) {
        cause = t('area.serverBusy');
    } else if (NETWORK.test(message) || /^HTTP \d+$/.test(message)) {
        cause = t('area.unstable');
    } else {
        // Not the network: a problem on this device or in the data. Retrying won't help by itself.
        return t('area.localFailure');
    }
    return kept > 0 ? `${cause} ${t('area.failedPartial', { done: kept, total })}` : `${cause} ${t('area.tryAgain')}`;
}
