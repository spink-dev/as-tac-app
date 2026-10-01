import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { onlineClient, OnlineApi, type OnlineProject, type Role } from '../../core/sync/client';
import { de } from '../../i18n/de';

export default function OnlinePanel() {
    const t = de.online;
    const [api, setApi] = useState<OnlineApi | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [projects, setProjects] = useState<OnlineProject[]>([]);
    const [selected, setSelected] = useState('');
    const [members, setMembers] = useState<{ user_id: string; role: Role }[]>([]);
    const [name, setName] = useState('');
    const [map, setMap] = useState('benglen');
    const [memberId, setMemberId] = useState('');
    const [role, setRole] = useState<'admin' | 'viewer'>('viewer');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const generation = useRef(0);
    const identity = useRef<string | null>(null);
    const project = projects.find((p) => p.id === selected);
    const owner = members.some((m) => m.user_id === user?.id && m.role === 'owner');
    useEffect(() => {
        try {
            const client = onlineClient();
            if (!client) {
                return;
            }
            setApi(new OnlineApi(client));
            const { data } = client.auth.onAuthStateChange((_event, session) => {
                const nextId = session?.user.id ?? null;
                setUser(session?.user ?? null);
                if (identity.current !== nextId) {
                    identity.current = nextId;
                    generation.current += 1;
                    setProjects([]);
                    setMembers([]);
                    setSelected('');
                    setMessage('');
                }
            });
            return () => {
                generation.current += 1;
                data.subscription.unsubscribe();
            };
        } catch {
            setMessage(t.unavailable);
        }
    }, []);
    async function refresh(target = selected) {
        if (!api) {
            return;
        }
        const current = generation.current;
        const list = await api.list();
        const id = list.some((p) => p.id === target) ? target : '';
        const membership = id ? await api.members(id) : [];
        if (current === generation.current) {
            setProjects(list);
            setSelected(id);
            setMembers(membership);
        }
    }
    async function run(action: () => Promise<void>) {
        if (busy) {
            return;
        }
        setBusy(true);
        setMessage('');
        const current = generation.current;
        try {
            await action();
        } catch {
            if (current === generation.current) {
                setMessage(t.failed);
                setProjects([]);
                setMembers([]);
                setSelected('');
            }
        } finally {
            setBusy(false);
        }
    }
    return <section className="online-panel" aria-label={t.title}><details>
        <summary>{t.title}</summary>
        {!api ? <p>{t.unavailable}</p> : !user ? <form onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
                const { error } = await api.client.auth.signInWithPassword({ email, password });
                setPassword('');
                if (error) {
                    throw error;
                }
            });
        }}>
            <p>{t.loginHint}</p>
            <label>{t.email}<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>{t.password}<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button disabled={busy}>{t.login}</button>
        </form> : <>
            <p>{user.email}<br />{t.accountId}: <code>{user.id}</code></p>
            <button disabled={busy} onClick={() => void run(async () => {
                const { error } = await api.client.auth.signOut({ scope: 'local' });
                if (error) {
                    throw error;
                }
            })}>{t.logout}</button>
            <p className="muted">{t.foundationHint}</p>
            <button disabled={busy} onClick={() => void run(() => refresh())}>{t.refresh}</button>
            <label htmlFor="online-project">{t.project}</label>
            <select id="online-project" disabled={busy} value={selected} onChange={(event) => void run(() => refresh(event.target.value))}>
                <option value="">{t.choose}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.document.name}</option>)}
            </select>
            <form onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                    await api.create(name.trim(), map);
                    await refresh();
                    setName('');
                    setMessage(t.created);
                });
            }}>
                <label>{t.newName}<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label>{t.map}<select value={map} onChange={(e) => setMap(e.target.value)}><option value="benglen">Zürich · Benglen</option><option value="mahlwinkel">Mahlwinkel</option></select></label>
                <button disabled={busy || !name.trim()}>{t.create}</button>
            </form>
            {project && <>
                <p>{t.revision(project.server_seq)} · {project.document.elements.length} {t.elements}</p>
                <h3>{t.members}</h3>
                <ul>{members.map((m) => <li key={m.user_id}><code>{m.user_id}</code> · {t.roles[m.role]}
                    {owner && m.role !== 'owner' && <button disabled={busy} onClick={() => void run(async () => {
                        await api.setMember(selected, m.user_id, null);
                        await refresh();
                    })}>{t.remove}</button>}
                </li>)}</ul>
                {owner && <form onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                        await api.setMember(selected, memberId.trim(), role);
                        await refresh();
                        setMemberId('');
                        setMessage(t.memberSaved);
                    });
                }}>
                    <label>{t.memberId}<input required value={memberId} onChange={(e) => setMemberId(e.target.value)} /></label>
                    <label>{t.role}<select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}><option value="viewer">{t.roles.viewer}</option><option value="admin">{t.roles.admin}</option></select></label>
                    <p className="muted">{t.roleHint}</p>
                    <button disabled={busy}>{t.saveMember}</button>
                </form>}
            </>}
        </>}
        {busy && <p role="status">{t.working}</p>}
        {message && <p role="status">{message}</p>}
    </details></section>;
}
