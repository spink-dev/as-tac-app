import { useState } from 'react';
import { events, eventProject } from './catalog';
import { loadMap, verifyPackage } from '../../core/packages/maps';
import { duplicateProject, validateProject } from '../../core/projects/model';
import type { ProjectSession } from '../../core/projects/session';
import { onlineClient } from '../../core/sync/client';
interface CatalogItem {
    id: string;
    title: string;
    site_id: string;
    event_id: string;
    edition: string;
}
export default function CatalogPanel({
    session,
    disabled,
    busyChanged,
    refresh,
}: {
    session: ProjectSession;
    disabled: boolean;
    busyChanged: (busy: boolean) => void;
    refresh: () => void;
}) {
    const [selected, setSelected] = useState(events[0].id);
    const [status, setStatus] = useState('');
    const [remote, setRemote] = useState<CatalogItem[]>([]);
    const [busy, setBusy] = useState(false);
    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        busyChanged(true);
        setStatus('Kartenpaket wird geprüft …');
        try {
            await task();
        } catch {
            setStatus(
                'Paket nicht verfügbar oder unvollständig. Der bisherige Plan bleibt erhalten. Verbindung und Offline-Dateien prüfen.',
            );
        } finally {
            setBusy(false);
            busyChanged(false);
        }
    };
    const install = async (value: { project: unknown; map: unknown }) => {
        validateProject(value.project);
        const map = await verifyPackage(value.map);
        if (value.project.mapPackageId !== map.id) {
            throw new Error('Map mismatch');
        }
        const project = duplicateProject(value.project, value.project.name);
        map.id = `local-${crypto.randomUUID()}`;
        project.mapPackageId = map.id;
        await session.importBundle(project, map, new AbortController().signal);
        refresh();
        setStatus(
            'Eventkarte auf diesem Gerät gespeichert. Unter Orientierung öffnen; für Änderungen unter Projekt eine bearbeitbare Kopie erstellen.',
        );
    };
    return (
        <section aria-label="Vorbereitete Eventkarten">
            <h2>Vorbereitete Eventkarten</h2>
            <p>Mahlwinkel · gemeinsame Geländekarte, eigene Einteilung je Event.</p>
            <label>
                Event
                <select aria-label="Event" value={selected} onChange={(event) => setSelected(event.target.value)}>
                    {events.map((event) => (
                        <option key={event.id} value={event.id}>
                            {event.name}
                        </option>
                    ))}
                </select>
            </label>
            <p className="muted">
                FieldMaps / @rwolffgang · Ausgabe r2. Dark Emergency: erweiterte Geländegrenze und fünf Safe-Zone-Flächen.
                HQ-Marker zeigen Standorte, keine vollständigen HQ-Grenzen. Grenzen sind ungefähre Nachzeichnungen; vor Ort prüfen.
                Vorhandene Projektkopien bleiben unverändert. Für diese Ausgabe die Eventkarte erneut speichern.
            </p>
            <button
                className="primary"
                disabled={disabled || busy}
                onClick={() =>
                    void run(async () =>
                        install({ project: eventProject(selected), map: await loadMap('mahlwinkel', new AbortController().signal) }),
                    )
                }
            >
                Eventkarte offline speichern
            </button>
            <details>
                <summary>Weitere veröffentlichte Karten</summary>
                <p>Vom Kartenstudio veröffentlichte Ausgaben laden und lokal behalten.</p>
                <button
                    disabled={disabled || busy}
                    onClick={() =>
                        void run(async () => {
                            const client = onlineClient();
                            if (!client) {
                                setStatus(
                                    'Der Online-Katalog ist noch nicht eingerichtet. Die Mahlwinkel-Vorlagen und Dateiimporte sind verfügbar.',
                                );
                                return;
                            }
                            const { data, error } = await client.rpc('ast_catalog');
                            if (error || !Array.isArray(data)) {
                                throw error ?? new Error('catalog');
                            }
                            setRemote(data);
                            setStatus(data.length ? 'Veröffentlichte Ausgaben geladen.' : 'Noch keine veröffentlichten Ausgaben.');
                        })
                    }
                >
                    Online-Katalog laden
                </button>
                {remote.map((item) => (
                    <div className="catalog-entry" key={item.id}>
                        <strong>{item.title}</strong>
                        <p>
                            {item.site_id} · {item.event_id} · {item.edition}
                        </p>
                        <button
                            disabled={disabled || busy}
                            onClick={() =>
                                void run(async () => {
                                    const { data, error } = await onlineClient()!.rpc('ast_catalog_package', { p_id: item.id });
                                    if (error || !data) {
                                        throw error ?? new Error('missing');
                                    }
                                    await install(data);
                                })
                            }
                        >
                            Ausgabe herunterladen
                        </button>
                    </div>
                ))}
            </details>
            {status && <p role="status">{status}</p>}
        </section>
    );
}
