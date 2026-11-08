import { t } from '../../i18n';

/**
 * What to tell the user after a failed area download, install or plan creation — a sentence,
 * never a raw code, and only «try again» when trying again can help.
 */
export function areaErrorText(error: unknown, kept = 0, total = 0): string {
    const message = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : '';
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
    if (name === 'QuotaExceededError' || /quota|storage.*full/i.test(message)) {
        return t('area.storageFull');
    }
    let cause: string;
    if (message === 'rate-limit' || message === 'overpass-incomplete') {
        cause = t('area.busy');
    } else if (/^HTTP 5\d\d$/.test(message)) {
        cause = t('area.serverBusy');
    } else if (message === 'overpass-format' || name === 'SyntaxError') {
        // An answer that is not map data (maintenance page, wrong file): the server's side.
        cause = t('area.serverOdd');
    } else if (/^HTTP (408|429)$/.test(message)) {
        // Overpass rate limits arrive as `rate-limit`: a plain 408/429 is another server.
        cause = t('area.serverBusy');
    } else if (/^HTTP 4\d\d$/.test(message)) {
        cause = t('area.serverRefused');
    } else if (/^(stalled|download|timeout)$/.test(message) || name === 'TypeError' && /fetch|network|load failed/i.test(message)) {
        // Failed fetches are TypeErrors; a database "aborted" is not the connection.
        cause = t('area.unstable');
    } else {
        // Not the network: a problem on this device or in the data. Retrying won't help by itself
        // (and a reload would lose the parts already loaded, so it is not suggested then).
        return kept > 0 ? `${t('area.localFailureKept')} ${t('area.failedPartial', { done: kept, total })}` : t('area.localFailure');
    }
    return kept > 0 ? `${cause} ${t('area.failedPartial', { done: kept, total })}` : `${cause} ${t('area.tryAgain')}`;
}
