import { useState } from 'react';
import { de } from '../../i18n/de';
import { ProjectError } from '../../core/projects/model';
import { type ProjectSession, type ProjectState } from '../../core/projects/session';

export default function ProjectPanel({ session, state, areaId, locked: navigationLocked = false }: { session: ProjectSession; state: ProjectState; areaId: string; locked?: boolean }) {
    const [name, setName] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [backupId, setBackupId] = useState('');
    const [downloadError, setDownloadError] = useState(false);
    const t = de.projects;
    const locked = !state.ready || state.busy || navigationLocked || !session.canLeave();
    const project = state.project;
    const errorCode = state.error instanceof ProjectError ? state.error.code : 'storage';
    async function download(id?: string) {
        try {
            const data = await session.recoveryData(id);
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'as-tac-local-recovery.json';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            setDownloadError(false);
        } catch {
            setDownloadError(true);
        }
    }
    return <section aria-label={t.title}>
        <h2>{t.title}</h2>
        <label htmlFor="project-open">{t.open}</label>
        <select id="project-open" value={project?.id ?? ''} disabled={locked} onChange={(event) => {
            setConfirmDelete(false);
            void session.open(event.target.value);
        }}>
            <option value="">{t.none}</option>
            {state.projects.map((item) => <option key={item.id} value={item.id}>{item.name}{item.readable ? '' : t.unreadable}</option>)}
        </select>
        <form onSubmit={(event) => {
            event.preventDefault();
            setConfirmDelete(false);
            void session.create(name.trim(), areaId);
        }}>
            <label htmlFor="project-new">{t.newName}</label>
            <input id="project-new" value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} />
            <button disabled={locked || !name.trim()} type="submit">{t.create}</button>
        </form>
        {project && <>
            <label htmlFor="project-name">{t.name}</label>
            <input id="project-name" value={project.name} maxLength={120} disabled={state.busy || navigationLocked} onChange={(event) => {
                session.change([{ kind: 'project', name: event.target.value }], 'name');
            }} />
            <p role="status" aria-live="polite">{t.states[state.saveState]}</p>
            <div className="actions">
                <button disabled={state.busy || navigationLocked || !state.canUndo} onClick={session.undo}>{t.undo}</button>
                <button disabled={state.busy || navigationLocked || !state.canRedo} onClick={session.redo}>{t.redo}</button>
                <button disabled={locked} onClick={() => {
                    setConfirmDelete(false);
                    void session.duplicate(t.copyName(project.name));
                }}>{t.duplicate}</button>
                <button disabled={locked} onClick={() => setConfirmDelete(true)}>{t.delete}</button>
            </div>
            {confirmDelete && <div className="project-warning">
                <p>{t.confirmDelete(project.name)}</p>
                <div className="actions"><button disabled={locked} onClick={() => {
                    setConfirmDelete(false);
                    void session.remove();
                }}>{t.deleteConfirm}</button><button onClick={() => setConfirmDelete(false)}>{t.cancel}</button></div>
            </div>}
        </>}
        {navigationLocked && <p className="muted">{t.actionLocked}</p>}
        {state.busy && <p role="status">{t.loading}</p>}
        {state.error != null && <div role="alert" className="project-warning">
            <p>{t.errors[errorCode]}</p>
            {state.saveState === 'error' && <>
                <p>{t.keepOpen}</p>
                <div className="actions">
                    <button disabled={state.busy || navigationLocked} onClick={() => void session.flush()}>{t.retry}</button>
                    <button disabled={state.busy || navigationLocked} onClick={() => void session.recoverCopy()}>{t.recoverCopy}</button>
                    <button onClick={() => void download()}>{t.downloadDraft}</button>
                </div>
            </>}
            {!state.ready && <button onClick={() => void session.start()}>{t.retry}</button>}
        </div>}
        {state.projects.some((item) => !item.readable) && <div className="project-warning">
            <label htmlFor="project-recovery">{t.recovery}</label>
            <select id="project-recovery" value={backupId} onChange={(event) => setBackupId(event.target.value)}>
                <option value="">{t.choose}</option>
                {state.projects.filter((item) => !item.readable).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button disabled={!backupId} onClick={() => void download(backupId)}>{t.downloadOriginal}</button>
        </div>}
        {downloadError && <p role="alert">{t.errors.storage}</p>}
        <p className="muted">{t.localOnly}</p>
    </section>;
}
