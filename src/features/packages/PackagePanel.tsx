import { useEffect, useRef, useState } from 'react';
import { de } from '../../i18n/de';
import { downloadMap, installMap, MAX_BYTES, validateBounds, type Bounds, type MapPackage } from '../../core/packages/maps';
import { ProjectDatabase } from '../../core/projects/database';

export default function PackagePanel({ current, viewport, refresh, select, disabled, busyChanged }: {
    current: MapPackage | null; viewport: Bounds | null; refresh: () => Promise<void>;
    select: (id: string) => void; disabled: boolean; busyChanged: (busy: boolean) => void;
}) {
    const t = de.packages;
    const [name, setName] = useState('');
    const [bounds, setBounds] = useState(['8.62', '47.349', '8.652', '47.373']);
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [remove, setRemove] = useState(false);
    const [nextDownload, setNextDownload] = useState(0);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    async function operation(run: (signal: AbortSignal) => Promise<MapPackage | null>) {
        if (controller.current) {
            return;
        }
        const abort = new AbortController();
        controller.current = abort;
        setBusy(true);
        busyChanged(true);
        setStatus(t.working);
        try {
            const pkg = await run(abort.signal);
            await refresh();
            if (pkg) {
                select(pkg.id);
            }
            setStatus(pkg ? t.installed : t.removed);
        } catch (error) {
            const code = error instanceof Error ? error.message : '';
            setStatus(abort.signal.aborted ? t.cancelled : (t.errors[code as keyof typeof t.errors] ?? t.failed));
        } finally {
            controller.current = null;
            setBusy(false);
            busyChanged(false);
        }
    }
    async function importFile(file: File) {
        await operation(async (signal) => {
            if (file.size > MAX_BYTES + 16_384) {
                throw new Error('size');
            }
            const value = JSON.parse(await file.text());
            signal.throwIfAborted();
            return installMap(value, signal);
        });
    }
    async function exportFile() {
        if (!current) {
            return;
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(current)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${current.id}.astac-map.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return <section aria-label={t.title}>
        <h2>{t.title}</h2>
        {current && <p>{current.name} · {(current.byteSize / 1024 / 1024).toFixed(2)} MiB<br />{t.date}: {current.dataTimestamp.slice(0, 10)} · {current.license}</p>}
        <details><summary>{t.add}</summary>
            <form onSubmit={(event) => {
                event.preventDefault();
                if (Date.now() < nextDownload) {
                    setStatus(t.cooldown);
                    return;
                }
                void operation(async (signal) => {
                    const bbox = bounds.map(Number);
                    validateBounds(bbox);
                    setNextDownload(Date.now() + 60_000);
                    return downloadMap(name.trim(), bbox, signal, (bytes) => setStatus(t.progress(bytes)));
                });
            }}>
                <label htmlFor="package-name">{t.name}</label>
                <input id="package-name" required maxLength={120} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
                <div className="coordinate-grid">{t.bounds.map((label, index) => <label key={label}>{label}
                    <input type="number" step="any" required value={bounds[index]} disabled={busy} onChange={(event) => setBounds(bounds.map((value, i) => i === index ? event.target.value : value))} />
                </label>)}</div>
                <button type="button" disabled={!viewport || busy} onClick={() => setBounds(viewport!.map((value) => value.toFixed(6)))}>{t.viewport}</button>
                <p className="muted">{t.limit}</p>
                <p className="muted">{t.provider}</p>
                <button type="submit" disabled={disabled || busy || !name.trim()}>{t.download}</button>
            </form>
            <label htmlFor="package-import">{t.import}</label>
            <input id="package-import" type="file" accept=".json,application/json" disabled={disabled || busy} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                    void importFile(file);
                }
                event.target.value = '';
            }} />
        </details>
        {status && <p role="status">{status}</p>}
        {busy && <button onClick={() => controller.current?.abort()}>{t.cancel}</button>}
        <div className="actions">
            <button disabled={!current || busy} onClick={() => void exportFile()}>{t.export}</button>
            {current?.id.startsWith('local-') && <button disabled={disabled || busy} onClick={() => setRemove(true)}>{t.delete}</button>}
        </div>
        {remove && <div className="project-warning"><p>{t.confirm}</p><div className="actions">
            <button disabled={disabled || busy} onClick={() => {
                setRemove(false);
                void operation(async () => {
                    const db = await ProjectDatabase.open();
                    try {
                        await db.removeMap(current!.id);
                        select('benglen');
                        return null;
                    } finally {
                        db.close();
                    }
                });
            }}>{t.deleteConfirm}</button><button onClick={() => setRemove(false)}>{t.cancel}</button>
        </div></div>}
    </section>;
}
