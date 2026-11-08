import { useEffect, useState } from 'react';
import { Copy, LogIn, Radio, Send, Unplug, UserPlus } from 'lucide-react';
import { useT } from '../../i18n';
import { useLive } from '../../core/live/state';
import { usePrefs } from '../../core/store/prefs';
import { useProject } from '../../core/store/project';
import { toast, useUi } from '../../core/store/ui';
import { Button, Empty, Field, Segmented } from '../../ui/components';
import { createInvite, goLive, myClientId, resolveConflict, sendChat, unlinkLive } from '../../core/live/session';
import { currentUser, sendMagicLink, signInDevice, supabaseConfigured } from '../../core/live/supabase';
import { registerPanel } from '../panels/registry';
import { QrSvg, appBaseUrl } from '../share/SharePanel';
import { JOIN_PREFIX } from '../../core/files/link';

function NotLive() {
    const t = useT();
    const readOnly = useProject((state) => state.readOnly);
    const displayName = usePrefs((state) => state.displayName);
    const [user, setUser] = useState<{ id: string; email: string | null; anonymous: boolean } | null>(null);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const configured = supabaseConfigured();
    const otherAccount = useLive((state) => state.error === 'other-account');
    useEffect(() => {
        if (configured) {
            void currentUser().then(setUser).catch(() => setUser(null));
        }
    }, [configured]);
    const run = async (fn: () => Promise<void>) => {
        setBusy(true);
        try {
            await fn();
        } catch (error) {
            console.warn('live action failed', error);
            toast(t('live.failed'), { tone: 'danger' });
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="stack">
            <p className="field__hint">{t('live.lead')}</p>
            {otherAccount ? <p className="notice notice--warn">{t('live.otherAccount')}</p> : null}
            <Field label={t('live.displayName')}>
                <input className="input" maxLength={40} value={displayName} placeholder={t('live.anonymous')} onChange={(event) => usePrefs.getState().set({ displayName: event.target.value })} />
            </Field>
            {configured ? (
                user ? (
                    <>
                        <p className="field__hint">{user.email ? t('live.signedInAs', { email: user.email }) : t('live.anonymousDevice')}</p>
                        <Button variant="primary" disabled={busy || Boolean(readOnly)} onClick={() => void run(() => goLive('supabase'))} data-testid="go-live"><Radio size={18} /> {t('live.start')}</Button>
                    </>
                ) : (
                    <>
                        <Button variant="primary" disabled={busy} onClick={() => void run(async () => {
                            await signInDevice();
                            setUser(await currentUser());
                        })}><LogIn size={18} /> {t('live.signInDevice')}</Button>
                        <form className="row-gap" onSubmit={(event) => {
                            event.preventDefault();
                            void run(async () => {
                                await sendMagicLink(email.trim());
                                toast(t('live.linkSent', { email: email.trim() }), { tone: 'ok' });
                            });
                        }}>
                            <input className="input" type="email" required value={email} placeholder={t('live.email')} aria-label={t('live.email')} onChange={(event) => setEmail(event.target.value)} />
                            <Button type="submit" disabled={busy || !email.includes('@')}>{t('live.sendLink')}</Button>
                        </form>
                        <p className="field__hint">{t('live.accountHint')}</p>
                    </>
                )
            ) : (
                <>
                    <p className="notice">{t('live.notConfigured')}</p>
                    <Button variant="primary" disabled={busy || Boolean(readOnly)} onClick={() => void run(() => goLive('loopback'))} data-testid="go-live"><Radio size={18} /> {t('live.startLocal')}</Button>
                </>
            )}
            <p className="field__hint">{t('live.gpsNever')} {t('live.imagesNote')}</p>
        </div>
    );
}

function Invite() {
    const t = useT();
    const [role, setRole] = useState<'viewer' | 'admin'>('viewer');
    const [code, setCode] = useState<string | null>(null);
    const streamer = useUi((state) => state.streamer);
    const link = code ? `${appBaseUrl()}${JOIN_PREFIX}${code}` : null;
    if (streamer !== 'off') {
        // An invite code on a stream would let any viewer join the plan.
        return (
            <section className="section">
                <div className="section__title">{t('live.invite')}</div>
                <p className="notice">{t('live.inviteStreamer')}</p>
            </section>
        );
    }
    return (
        <section className="section">
            <div className="section__title">{t('live.invite')}</div>
            <Segmented block value={role} onChange={(value) => {
                setRole(value);
                setCode(null);
            }} options={[{ value: 'viewer', label: t('live.inviteViewer') }, { value: 'admin', label: t('live.inviteAdmin') }]} />
            {code && link ? (
                <div className="invite">
                    <QrSvg text={link} label={t('live.inviteCode')} />
                    <span className="invite__code data" data-testid="invite-code">{code.slice(0, 4)} {code.slice(4)}</span>
                    <p className="field__hint">{t('live.inviteHint')}</p>
                    <Button small variant="ghost" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast(t('share.linkCopied'), { tone: 'ok' }))}><Copy size={16} /> {t('share.copyLink')}</Button>
                </div>
            ) : (
                <Button onClick={async () => {
                    try {
                        setCode(await createInvite(role));
                    } catch {
                        toast(t('live.failed'), { tone: 'danger' });
                    }
                }} data-testid="create-invite"><UserPlus size={18} /> {t('live.inviteCreate')}</Button>
            )}
        </section>
    );
}

function Chat() {
    const t = useT();
    const chat = useLive((state) => state.chat);
    const [text, setText] = useState('');
    useEffect(() => {
        useLive.setState({ unread: 0 });
    }, [chat.length]);
    return (
        <section className="section">
            <div className="section__title">{t('live.chat')}</div>
            {chat.length === 0 ? <Empty>{t('live.chatEmpty')}</Empty> : (
                <ol className="chat" aria-live="polite">
                    {chat.slice(-50).map((message) => (
                        <li key={message.id} className="chat__msg">
                            <span className="chat__meta"><strong>{message.authorName || t('live.anonymous')}</strong> <time className="num">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
                            <span className="chat__body">{message.body}</span>
                        </li>
                    ))}
                </ol>
            )}
            <form className="row-gap" onSubmit={(event) => {
                event.preventDefault();
                const body = text.trim();
                if (body) {
                    setText('');
                    void sendChat(body).catch(() => toast(t('live.failed'), { tone: 'danger' }));
                }
            }}>
                <input className="input" maxLength={1000} value={text} placeholder={t('live.chatPlaceholder')} aria-label={t('live.chatPlaceholder')} onChange={(event) => setText(event.target.value)} />
                <Button type="submit" variant="primary" disabled={!text.trim()} aria-label={t('live.chatSend')}><Send size={18} /></Button>
            </form>
        </section>
    );
}

export function LivePanel() {
    const t = useT();
    const status = useLive((state) => state.status);
    const role = useLive((state) => state.role);
    const backend = useLive((state) => state.backend);
    const presence = useLive((state) => state.presence);
    const queued = useLive((state) => state.queued);
    const conflicts = useLive((state) => state.conflicts);
    const project = useProject((state) => state.project);
    const [confirmStop, setConfirmStop] = useState(false);
    if (!project) {
        return null;
    }
    if (status === 'off') {
        return <NotLive />;
    }
    const me = myClientId();
    const stop = () => {
        // Unsent changes would be lost with the link: ask once more first.
        if (queued > 0 && !confirmStop) {
            setConfirmStop(true);
            return;
        }
        setConfirmStop(false);
        void unlinkLive(project.id).then(() => {
            toast(t('live.left'));
            useUi.getState().openPanel(null);
        });
    };
    const admin = role === 'owner' || role === 'admin';
    return (
        <div className="stack" data-testid="live-panel">
            <div className="live-status">
                <span className={`live-dot live-dot--${status}`} aria-hidden />
                <strong>{status === 'online' ? (queued > 0 ? t('live.connecting') : t('live.synced')) : status === 'connecting' ? t('live.connecting') : t('live.offlineQueued', { n: queued })}</strong>
                <span className="spacer" />
                <span className="badge">{role ? t(`live.role.${role}`) : ''}</span>
                {backend === 'loopback' ? <span className="badge badge--warn">{t('live.testMode')}</span> : null}
            </div>
            {conflicts.length > 0 ? (
                <section className="section">
                    <div className="section__title">{t('live.conflicts')}</div>
                    <ul className="conflict-list">
                        {conflicts.map((conflict) => (
                            <li key={conflict.id} className="conflict">
                                <span className="conflict__name">{conflict.label}</span>
                                <span className="row-gap">
                                    <Button small variant="ghost" onClick={() => resolveConflict(conflict.id, false)}>{t('live.keepTheirs')}</Button>
                                    <Button small onClick={() => resolveConflict(conflict.id, true)}>{t('live.keepMine')}</Button>
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="field__hint">{t('live.conflictNote')}</p>
                </section>
            ) : null}
            <section className="section">
                <div className="section__title">{t('live.present', { n: presence.length })}</div>
                <ul className="people">
                    {presence.map((person) => (
                        <li key={person.clientId} className="person">
                            <span className="face" style={{ background: person.color }} aria-hidden>{person.name.slice(0, 1).toUpperCase()}</span>
                            <span className="person__name">{person.name}{person.clientId === me ? ` (${t('live.you')})` : ''}</span>
                            {person.leading ? <span className="badge badge--ok">{t('live.leads')}</span> : null}
                            <span className="badge">{t(`live.role.${person.role}`)}</span>
                        </li>
                    ))}
                </ul>
            </section>
            {admin ? <Invite /> : <p className="notice">{t('live.viewerLock')}</p>}
            {admin ? <Chat /> : null}
            <p className="field__hint">{t('live.gpsNever')}</p>
            {confirmStop && queued > 0 ? (
                <div className="notice notice--warn" role="alert">
                    <p>{t('live.stopConfirm', { n: queued })}</p>
                    <span className="row-gap">
                        <Button small variant="ghost" onClick={() => setConfirmStop(false)}>{t('common.cancel')}</Button>
                        <Button small variant="danger" onClick={stop} data-testid="live-stop-confirm">{t('live.stop')}</Button>
                    </span>
                </div>
            ) : (
                <Button variant="ghost" onClick={stop} data-testid="live-stop"><Unplug size={18} /> {t('live.stop')}</Button>
            )}
        </div>
    );
}

registerPanel('live', 'panel.live', LivePanel);
