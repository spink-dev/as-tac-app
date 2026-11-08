import { CloudOff, Radio } from 'lucide-react';
import { useLive } from '../../core/live/state';
import { useUi } from '../../core/store/ui';
import { useT } from '../../i18n';

export function LiveBadge() {
    const t = useT();
    const status = useLive((state) => state.status);
    const presence = useLive((state) => state.presence);
    const queued = useLive((state) => state.queued);
    const unread = useLive((state) => state.unread);
    if (status === 'off') {
        return null;
    }
    const label = status === 'online' ? t('live.present', { n: presence.length }) : status === 'connecting' ? t('live.connecting') : t('live.offlineQueued', { n: queued });
    return (
        <button type="button" className={`live-badge live-badge--${status}`} onClick={() => useUi.getState().openPanel('live')} title={label}>
            {status === 'online' ? <Radio size={16} strokeWidth={2} /> : <CloudOff size={16} strokeWidth={2} />}
            <span className="live-badge__faces" aria-hidden>
                {presence.slice(0, 3).map((person) => (
                    <span key={person.clientId} className="face" style={{ background: person.color }}>{person.name.slice(0, 1).toUpperCase()}</span>
                ))}
            </span>
            <span className="live-badge__text">{label}</span>
            {unread > 0 ? <span className="live-badge__unread num">{unread}</span> : null}
        </button>
    );
}
