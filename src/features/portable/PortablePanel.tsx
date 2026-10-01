import { useEffect, useRef, useState } from 'react';
import { de } from '../../i18n/de';
import { exportProject, importProject } from '../../core/portable/project';
import { ARCHIVE_LIMIT } from '../../core/portable/archive';
import type { MapPackage } from '../../core/packages/maps';
import type { ProjectSession, ProjectState } from '../../core/projects/session';

export default function PortablePanel({ session, state, map, disabled, refresh, busyChanged }: {
    session: ProjectSession; state: ProjectState; map: MapPackage | null; disabled: boolean;
    refresh: () => Promise<void>; busyChanged: (busy: boolean) => void;
}) {
    const t = de.portable;
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    async function run(file?: File) {
        if (disabled || controller.current) {
            return;
        }
        const abort = new AbortController();
        controller.current = abort;
        setBusy(true);
        busyChanged(true);
        setStatus(t.working);
        try {
            if (file) {
                if (file.size > ARCHIVE_LIMIT) {
                    throw new Error('size');
                }
                const bundle = await importProject(new Uint8Array(await file.arrayBuffer()), abort.signal);
                const estimate = await navigator.storage?.estimate?.();
                if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < bundle.map.byteSize * 2 + 1024 * 1024) {
                    throw new Error('quota');
                }
                await session.importBundle(bundle.project, bundle.map, abort.signal);
                await refresh();
                setStatus(t.imported);
            } else if (state.project && map) {
                const bytes = await exportProject(state.project, map, session.getRevision());
                abort.signal.throwIfAborted();
                const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = `${state.project.id}.astac.zip`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
                setStatus(t.exported);
            }
        } catch {
            setStatus(abort.signal.aborted ? t.cancelled : t.failed);
        } finally {
            controller.current = null;
            setBusy(false);
            busyChanged(false);
        }
    }
    return <section aria-label={t.title}>
        <h2>{t.title}</h2><p className="muted">{t.hint}</p>
        <button disabled={disabled || busy || !state.project || !map || state.project.mapPackageId !== map.id} onClick={() => void run()}>{t.export}</button>
        <label htmlFor="project-import">{t.import}</label>
        <input id="project-import" type="file" accept=".zip,application/zip,application/x-zip-compressed" disabled={disabled || busy} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
                void run(file);
            }
        }} />
        <p className="muted">{t.limit}</p>
        {status && <p role="status">{status}</p>}
        {busy && <button onClick={() => controller.current?.abort()}>{de.packages.cancel}</button>}
    </section>;
}
