import { useEffect, useState } from 'react';
import { workspaceOf, validateProject, type Project, type Workspace } from '../../core/projects/model';
import type { Command } from '../../core/projects/commands';
import { verifyPackage, type MapPackage } from '../../core/packages/maps';
import { onlineClient } from '../../core/sync/client';
export default function StudioPanel({
    project,
    map,
    change,
    disabled,
    saved,
}: {
    project: Project;
    map: MapPackage | null;
    change: (commands: Command[]) => void;
    disabled: boolean;
    saved: boolean;
}) {
    const [root, setRoot] = useState(false);
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [draft, setDraft] = useState(workspaceOf(project));
    const [dirty, setDirty] = useState(false);
    useEffect(() => {
        if (!dirty) {
            setDraft(workspaceOf(project));
        }
    }, [project.workspace, dirty]);
    useEffect(() => {
        const client = onlineClient();
        if (!client) {
            return;
        }
        let current = true;
        let generation = 0;
        const check = async () => {
            const attempt = ++generation;
            setRoot(false);
            const { data, error } = await client.rpc('ast_is_root');
            if (current && attempt === generation) {
                setRoot(!error && data === true);
            }
        };
        void check();
        const subscription = client.auth.onAuthStateChange(() => {
            // Avoid invoking an auth-dependent request inside the client's auth lock.
            queueMicrotask(() => void check());
        });
        return () => {
            current = false;
            subscription.data.subscription.unsubscribe();
        };
    }, []);
    const field = (key: keyof Omit<Workspace, 'layers'>, label: string, max = 120) => (
        <label>
            {label}
            <input
                maxLength={max}
                value={draft[key]}
                onChange={(event) => {
                    setDraft({ ...draft, [key]: event.target.value });
                    setDirty(true);
                }}
            />
        </label>
    );
    return (
        <details className="studio-panel">
            <summary>Kartenstudio {root ? '· Root' : ''}</summary>
            <p>
                Ein Gelände, mehrere Events. Verwende eine eigene Projektkopie je Event und Ausgabe. Zeichne Zonen und Gebäudebezeichnungen
                unter Planung auf getrennten Ebenen.
            </p>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    change([{ kind: 'project', schemaVersion: 2, workspace: { ...draft, layers: workspaceOf(project).layers } }]);
                    setDirty(false);
                }}
            >
                <fieldset disabled={disabled || busy}>
                    {field('siteId', 'Gelände-ID')}
                    {field('eventId', 'Event-ID')}
                    {field('edition', 'Ausgabe')}
                    {field('source', 'Quellen und Genauigkeit', 2000)}
                    <button disabled={!dirty}>Kartendaten speichern</button>
                </fieldset>
            </form>
            {project.workspace?.source && <p className="muted">{project.workspace.source}</p>}
            <h3>Im Katalog veröffentlichen</h3>
            <p>
                {root
                    ? 'Root-Berechtigung bestätigt. Veröffentlichte Ausgaben bleiben unverändert. Für Anpassungen eine neue Ausgabe vergeben.'
                    : 'Veröffentlichen ist nur mit einer serverseitig vergebenen Root-Berechtigung möglich. Anmeldung unter Online-Zusammenarbeit. Lokale Entwürfe lassen sich auch als Projektpaket weitergeben.'}
            </p>
            <button
                disabled={
                    !root ||
                    disabled ||
                    busy ||
                    dirty ||
                    !saved ||
                    !map ||
                    map.id !== project.mapPackageId ||
                    !project.workspace ||
                    ['siteId', 'eventId', 'edition', 'source'].some(
                        (key) => !project.workspace![key as keyof Omit<Workspace, 'layers'>].trim(),
                    )
                }
                onClick={async () => {
                    if (!map) {
                        return;
                    }
                    setBusy(true);
                    setStatus('Ausgabe wird geprüft und veröffentlicht …');
                    try {
                        validateProject(project);
                        await verifyPackage(map);
                        const { error } = await onlineClient()!.rpc('ast_publish', {
                            p_id: crypto.randomUUID(),
                            p_document: project,
                            p_map: map,
                        });
                        if (error) {
                            throw error;
                        }
                        setStatus('Ausgabe veröffentlicht. Sie steht unter Karten im Online-Katalog bereit.');
                    } catch {
                        setStatus(
                            'Veröffentlichung nicht bestätigt. Katalog prüfen; eine bestehende Ausgabe kann nicht überschrieben werden.',
                        );
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                Diese Ausgabe veröffentlichen
            </button>
            {status && <p role="status">{status}</p>}
        </details>
    );
}
