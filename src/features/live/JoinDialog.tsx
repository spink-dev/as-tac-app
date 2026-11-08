import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { useT } from '../../i18n';
import { useDialogs } from '../../core/store/dialogs';
import { usePrefs } from '../../core/store/prefs';
import { Button, Dialog, Field } from '../../ui/components';
import { joinLive, preferredBackend } from '../../core/live/session';
import { currentUser, signInDevice } from '../../core/live/supabase';
import { closeProject, openProject, useRoute } from '../../core/store/route';
import { toast } from '../../core/store/ui';

const CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** Join a live plan with an 8-character invite code (typed, or from a `?join=` link / QR). */
export function JoinDialog() {
    const t = useT();
    const open = useDialogs((state) => state.open === 'join');
    const payload = useDialogs((state) => (state.open === 'join' ? state.payload as { code?: string } | null : null));
    const hide = useDialogs((state) => state.hide);
    const displayName = usePrefs((state) => state.displayName);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [loaded, setLoaded] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (open) {
            setCode((payload?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
            setError(null);
        }
    }, [open, payload]);
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const valid = CODE.test(normalized);
    const backend = preferredBackend();

    const join = async () => {
        setBusy(true);
        setError(null);
        try {
            if (backend === 'supabase' && !(await currentUser())) {
                await signInDevice();
            }
            // Visible from the first byte: on a slow link the download can take a while.
            setLoaded(0);
            const { project, info, alreadyMember } = await joinLive(normalized, backend, setLoaded);
            if (useRoute.getState().route.name === 'workspace' && !(await closeProject())) {
                return;
            }
            hide();
            await openProject(project.id);
            // A code never changes the role of someone who is already a member (the owner does that).
            toast(alreadyMember ? t('live.alreadyMember', { name: info.name, role: t(`live.role.${info.role}`) }) : t('live.joined', { name: info.name }), { tone: 'ok' });
        } catch (err) {
            console.warn('join failed', err);
            setError(err instanceof Error && err.message === 'invite' ? t('live.codeInvalid') : err instanceof Error && (err.message === 'newer' || err.message === 'live-newer') ? t('library.errorNewer') : t('live.failed'));
        } finally {
            setBusy(false);
            setLoaded(null);
        }
    };

    return (
        <Dialog open={open} onClose={hide} title={t('library.join')} footer={(
            <>
                <Button variant="ghost" onClick={hide}>{t('common.cancel')}</Button>
                <Button variant="primary" disabled={!valid || busy} onClick={() => void join()} data-testid="join-submit"><Radio size={18} /> {t('live.join')}</Button>
            </>
        )}>
            <form className="stack" onSubmit={(event) => {
                event.preventDefault();
                if (valid && !busy) {
                    void join();
                }
            }}>
                <p className="dialog__lead">{t('live.joinLead')}</p>
                <Field label={t('live.joinCode')}>
                    <input className="input input--code data" value={code} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={9}
                        placeholder="ABCD 2345" aria-invalid={code.length > 0 && !valid} data-testid="join-code"
                        onChange={(event) => setCode(event.target.value.toUpperCase())} />
                </Field>
                <Field label={t('live.displayName')}>
                    <input className="input" maxLength={40} value={displayName} placeholder={t('live.anonymous')} onChange={(event) => usePrefs.getState().set({ displayName: event.target.value })} />
                </Field>
                {backend === 'loopback' ? <p className="field__hint">{t('live.notConfigured')}</p> : null}
                {busy && loaded !== null ? <p className="field__hint" role="status" data-testid="join-progress">{t('live.joinProgress', { n: loaded })}</p> : null}
                {error ? <p className="notice notice--danger" role="alert">{error}</p> : null}
                <p className="field__hint">{t('live.gpsNever')}</p>
            </form>
        </Dialog>
    );
}
