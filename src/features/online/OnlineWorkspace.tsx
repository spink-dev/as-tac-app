import WorkspaceShell, { type WorkspaceTab } from '../workspace/WorkspaceShell';
import { exportProject } from '../../core/portable/project';
import { de } from '../../i18n/de';
import { version } from '../../../package.json';
import { usePresentation } from '../../core/sync/briefing';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import { OnlineSession, scope } from '../../core/sync/session';
import { IndexedDraftStore, type CachedProject } from '../../core/sync/drafts';
import type { OnlineApi } from '../../core/sync/client';
import { useMaps } from '../../core/packages/useMaps';
import { useLocation } from '../../core/location/useLocation';
import MapView from '../map/MapView';
import { useEditor } from '../editor/useEditor';
import EditorPanel from '../editor/EditorPanel';
import ManagementPanel from '../briefing/ManagementPanel';
import BriefingPanel from '../briefing/BriefingPanel';
import type { Phase } from '../../core/projects/model';

export interface OnlineTarget {
    api: OnlineApi;
    projectId: string;
    userId: string;
    offline?: CachedProject;
}
const statusText = {
    connecting: 'Verbinden …',
    live: 'Serverstand bestätigt · wird alle 1,5 Sekunden aktualisiert',
    saving: 'Änderung wird gesichert und gesendet …',
    offline: 'Offline · letzter bestätigter Stand',
    draft: 'Eigener Entwurf · noch nicht auf dem Server bestätigt',
    conflict: 'Konflikt · eigenen Entwurf mit Server vergleichen',
    denied: 'Zugriff fehlt',
    'storage-error': 'Lokaler Speicherfehler · Entwurf exportieren',
};
export default function OnlineWorkspace({ target, close }: { target: OnlineTarget; close: () => void }) {
    const [tab, setTab] = useState<WorkspaceTab>('field');
    const [session] = useState(
        () =>
            new OnlineSession(
                target.api,
                target.projectId,
                target.userId,
                new IndexedDraftStore(`${target.userId}:${target.projectId}`),
                target.offline,
            ),
    );
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const maps = useMaps(state.project?.mapPackageId ?? 'benglen');
    const [map, setMap] = useState<LibreMap | null>(null);
    const [follow, setFollow] = useState(false);
    const onViewport = useCallback(() => {}, []);
    const pauseFollow = useCallback(() => setFollow(false), []);
    const [phase, setPhase] = useState<Phase | null>(null);
    const gps = useLocation();
    const editing = useRef(false);
    const [inputEpoch, setInputEpoch] = useState(0);
    const pauseEditor = useCallback(() => {
        pauseFollow();
        if (editing.current) {
            session.hold();
        }
    }, [session, pauseFollow]);
    const editor = useEditor(
        map,
        maps.current?.id === state.project?.mapPackageId ? state.project : null,
        session.change,
        pauseEditor,
        phase?.visibleElementIds ?? null,
    );
    editing.current = editor.editing;
    const [exporting, setExporting] = useState(false);
    const [exportStatus, setExportStatus] = useState('');
    const [lockError, setLockError] = useState('');
    const [mine, setMine] = useState<string[]>([]);
    const [reviewed, setReviewed] = useState<number | null>(null);
    const presentation = usePresentation(
        target.api,
        target.projectId,
        target.userId,
        map,
        phase,
        !target.offline && ['owner', 'admin'].includes(state.role ?? '') && !['denied', 'offline', 'connecting'].includes(state.status),
        pauseFollow,
        !target.offline,
    );
    const readOnly = !state.role || state.role === 'viewer';
    const disabled =
        readOnly || state.busy || !!state.draft?.sent || !['live', 'offline', 'draft'].includes(state.status) || maps.loading || maps.error;
    const onPhase = useCallback(
        (next: Phase | null) => {
            setPhase(next);
            if (next) {
                editor.cancel();
                editor.setEditing(false);
                editor.setVisible(true);
                pauseFollow();
            }
        },
        [editor.cancel, editor.setEditing, editor.setVisible, pauseFollow],
    );
    useEffect(() => {
        if (readOnly) {
            editor.cancel();
            editor.setEditing(false);
        }
    }, [readOnly, editor.cancel, editor.setEditing]);
    useEffect(() => {
        let disposed = false;
        let release: (() => void) | undefined;
        const lock = navigator.locks?.request(`as-tac-online:${target.userId}:${target.projectId}`, { ifAvailable: true }, async (held) => {
            if (!held) {
                setLockError('Dieses Online-Projekt ist bereits in einem anderen Tab geöffnet. Dort fortsetzen oder den Tab schliessen.');
                return;
            }
            if (disposed) {
                return;
            }
            const lifetime = new Promise<void>((resolve) => {
                release = resolve;
            });
            await session.start();
            if (!disposed && !target.offline) {
                session.poll();
            }
            await lifetime;
        });
        if (!lock) {
            setLockError('Dieser Browser unterstützt die sichere Tab-Sperre nicht. Bitte einen aktuellen Browser verwenden.');
        } else {
            void lock.catch(() => setLockError('Tab-Sperre konnte nicht geöffnet werden.'));
        }
        const auth = target.api.client.auth.onAuthStateChange((_event, authSession) => {
            if (!target.offline && authSession?.user.id !== target.userId) {
                session.dispose();
                close();
            }
        });
        return () => {
            disposed = true;
            session.dispose();
            release?.();
            auth.data.subscription.unsubscribe();
        };
    }, [session, target, close]);
    useEffect(() => {
        const guard = (event: BeforeUnloadEvent) => {
            if (state.busy || state.held || state.status === 'storage-error' || editor.hasDraft || editor.hasUnsavedForm) {
                event.preventDefault();
            }
        };
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [state.busy, state.held, state.status, editor.hasDraft || editor.hasUnsavedForm]);
    const projectTools = (
        <>
            {' '}
            <section aria-label="Online-Status">
                {target.offline && (
                    <p>Offline-Kopie · zum Abgleichen zur lokalen Planung zurückkehren, anmelden und das Online-Projekt öffnen.</p>
                )}
                <h2>Gemeinsamer Plan</h2>
                <p role="status">{statusText[state.status]}</p>
                <p>
                    {state.role === 'viewer'
                        ? 'Mitglied · schreibgeschützt'
                        : state.role === 'owner'
                          ? 'Eigentümer'
                          : state.role === 'admin'
                            ? 'Admin'
                            : 'Mitgliedschaft wird geprüft'}{' '}
                    · Serverstand {state.snapshot?.server_seq ?? '–'}
                </p>
                {(state.error || lockError) && <p role="alert">{lockError || state.error}</p>}
                {state.held && (
                    <>
                        <p>
                            Deine Eingabe behält den Kartenstand vom Beginn der Bearbeitung. Änderungen anderer werden beim Speichern
                            verglichen.
                        </p>
                        <button
                            onClick={() => {
                                editor.cancel();
                                session.resume();
                                setInputEpoch((n) => n + 1);
                            }}
                        >
                            Eingabe verwerfen und aktuellen Stand laden
                        </button>
                    </>
                )}
                <button disabled={!!target.offline || state.busy || !!lockError} onClick={() => void session.refresh()}>
                    Serverstand prüfen
                </button>
                {state.draft && (
                    <>
                        <p>
                            Die Karte zeigt deinen Entwurf. Noch nicht gesendete Entwürfe kannst du weiter bearbeiten. Bei unklarem
                            Sendestatus ist die nächste Änderung bis zum Abgleich gesperrt. Nach Neuladen und Anmeldung wird der Entwurf
                            wieder geöffnet.
                        </p>
                        <button
                            onClick={() => {
                                const url = URL.createObjectURL(
                                    new Blob([JSON.stringify(state.draft!.project, null, 2)], { type: 'application/json' }),
                                );
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'as-tac-entwurf.json';
                                a.click();
                                setTimeout(() => URL.revokeObjectURL(url), 1000);
                            }}
                        >
                            Entwurf als JSON sichern
                        </button>
                        <button disabled={!!target.offline || state.busy || readOnly} onClick={() => void session.retry()}>
                            Unveränderte Sendung erneut prüfen
                        </button>
                        {state.snapshot && (
                            <>
                                <button
                                    disabled={!!target.offline || state.busy || readOnly}
                                    onClick={() => {
                                        setMine(state.draft!.changes.map(scope));
                                        setReviewed(state.snapshot!.server_seq);
                                    }}
                                >
                                    Mit Serverstand vergleichen
                                </button>
                                {reviewed !== null && (
                                    <div>
                                        <p>
                                            Serverstand {reviewed}. Häkchen übernehmen deinen Wert; ohne Häkchen bleibt der Serverwert.
                                            Referenzen müssen zusammen passen.
                                        </p>
                                        {state.draft.changes.map((c) => {
                                            const key = scope(c);
                                            const server =
                                                c.kind === 'project'
                                                    ? {
                                                          name: state.snapshot!.document.name,
                                                          mapPackageId: state.snapshot!.document.mapPackageId,
                                                          schemaVersion: state.snapshot!.document.schemaVersion,
                                                          workspace: state.snapshot!.document.workspace,
                                                      }
                                                    : ((c.kind === 'element'
                                                          ? state.snapshot!.document.elements
                                                          : c.kind === 'team'
                                                            ? state.snapshot!.document.teams
                                                            : state.snapshot!.document.phases
                                                      ).find((x) => x.id === c.id) ?? null);
                                            return (
                                                <details key={key}>
                                                    <summary>
                                                        {c.kind} · {c.id} {session.conflicts().includes(key) ? '· geändert' : ''}
                                                    </summary>
                                                    <label className="check-label">
                                                        <input
                                                            type="checkbox"
                                                            checked={mine.includes(key)}
                                                            onChange={(e) =>
                                                                setMine(e.target.checked ? [...mine, key] : mine.filter((s) => s !== key))
                                                            }
                                                        />
                                                        Eigenen Wert übernehmen
                                                    </label>
                                                    <p>Dein Wert</p>
                                                    <pre>{JSON.stringify(c.value, null, 2)}</pre>
                                                    <p>Serverwert</p>
                                                    <pre>{JSON.stringify(server, null, 2)}</pre>
                                                </details>
                                            );
                                        })}
                                        {reviewed !== state.snapshot.server_seq && (
                                            <p role="alert">Server wurde erneut geändert. Vergleich bitte neu öffnen.</p>
                                        )}
                                        <button
                                            disabled={state.busy || readOnly || reviewed !== state.snapshot.server_seq}
                                            onClick={() => void session.resolve(mine, reviewed)}
                                        >
                                            Auswahl ausdrücklich publizieren
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </section>
            <details>
                <summary>{de.app.sources}</summary>
                <p>AS-TAC · v{version}</p>
                <p>
                    © OpenStreetMap contributors · <a href="/licenses/ODbL-1.0.txt">ODbL 1.0</a>
                </p>
                <p>
                    {de.app.thanks} <a href="https://github.com/rwolffgang/FieldMaps">FieldMaps / @rwolffgang</a> {de.app.reference}
                </p>
                <p>
                    <a href="/licenses/CREDITS.md">{de.app.provenance}</a> · <a href="/licenses/dependencies.txt">{de.app.libraries}</a>
                </p>
            </details>
            <button
                disabled={
                    (state.busy && !lockError) || state.held || state.status === 'storage-error' || editor.hasDraft || editor.hasUnsavedForm
                }
                onClick={close}
            >
                Zur lokalen Planung
            </button>
        </>
    );
    const mapTools = (
        <>
            {' '}
            <section>
                <h2>Offline-Paket</h2>
                <p>
                    Vollständige lokale Kopie mit Karte, Plan und Quellen.{' '}
                    {state.draft ? 'Enthält deinen unbestätigten Entwurf.' : 'Enthält den bestätigten Serverstand.'}
                </p>
                <button
                    disabled={exporting || !state.project || !maps.current || state.project.mapPackageId !== maps.current.id}
                    onClick={async () => {
                        if (!state.project || !maps.current) {
                            return;
                        }
                        setExporting(true);
                        setExportStatus('Paket wird erstellt …');
                        try {
                            const bytes = await exportProject(state.project, maps.current, state.snapshot?.server_seq ?? 0);
                            const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `${state.project.id}${state.draft ? '-entwurf' : ''}.astac.zip`;
                            link.click();
                            setTimeout(() => URL.revokeObjectURL(url), 10_000);
                            setExportStatus('Paket erstellt. Als lokale Kopie auf jedem vorbereiteten Gerät importierbar.');
                        } catch {
                            setExportStatus('Paket konnte nicht erstellt werden. Karte und Offline-Dateien prüfen.');
                        } finally {
                            setExporting(false);
                        }
                    }}
                >
                    Karten- und Planpaket exportieren
                </button>
                {exportStatus && <p role="status">{exportStatus}</p>}
            </section>
        </>
    );
    const briefing = (
        <>
            {' '}
            <section aria-label="Online-Briefing">
                <h2>Online-Briefing</h2>
                <p>
                    {presentation.isLeader
                        ? 'Du leitest das Briefing. Phase und Kartenausschnitt werden übertragen.'
                        : presentation.state
                          ? 'Eine Präsentation läuft. Deine Ansicht bleibt frei, bis du Folgen einschaltest.'
                          : 'Zurzeit keine aktive Präsentation.'}
                </p>
                {presentation.error && <p role="status">{presentation.error}</p>}
                {presentation.isLeader ? (
                    <button disabled={presentation.busy} onClick={() => void presentation.release()}>
                        Leitung abgeben
                    </button>
                ) : (
                    <button
                        disabled={!!target.offline || readOnly || state.status !== 'live' || presentation.busy || !!presentation.state}
                        onClick={() => void presentation.claim()}
                    >
                        Briefing leiten
                    </button>
                )}
                {!presentation.isLeader && (
                    <label className="check-label">
                        <input
                            type="checkbox"
                            checked={presentation.following}
                            disabled={!presentation.state || editor.hasDraft || editor.hasUnsavedForm}
                            onChange={(e) => {
                                editor.cancel();
                                editor.setEditing(false);
                                presentation.follow(e.target.checked);
                            }}
                        />
                        Präsentation folgen
                    </label>
                )}
                <p className="muted">
                    Ohne Verbindung endet die Leitung nach spätestens 20 Sekunden. Folgen ist freiwillig; GPS wird nicht übertragen.
                </p>
            </section>
            <BriefingPanel
                remotePhase={presentation.following && presentation.state ? { id: presentation.state.phaseId } : undefined}
                project={state.project}
                map={map}
                change={session.change}
                onPhase={onPhase}
                disabled={state.busy || editor.hasDraft || editor.hasUnsavedForm || maps.loading || maps.error}
                pauseFollow={pauseFollow}
                readOnly={disabled}
            />
        </>
    );
    const field = (
        <>
            {' '}
            <section>
                <h2>Eigener Standort</h2>
                <p role="status">{gps.gps}</p>
                <p>GPS bleibt auf diesem Gerät.</p>
                <button
                    onClick={() => {
                        setFollow(true);
                        gps.startGps();
                    }}
                >
                    Standort anzeigen
                </button>
                {gps.active && <button onClick={gps.stopGps}>Standort stoppen</button>}
                {gps.fix && (
                    <p>
                        {gps.fix.latitude.toFixed(6)}, {gps.fix.longitude.toFixed(6)}
                        <br />± {Math.round(gps.fix.accuracy)} m ·{' '}
                        {de.location.age(Math.max(0, Math.floor((gps.now - gps.fix.timestamp) / 1000)), gps.stale)}
                    </p>
                )}
                {gps.fix && !gps.stale && gps.fix.accuracy > 50 && <p>{de.location.imprecise}</p>}
            </section>
            {tab === 'field' && (
                <EditorPanel
                    editor={editor}
                    project={state.project}
                    session={session}
                    state={{ saveState: 'saved', canUndo: false, canRedo: false }}
                    disabled
                    statusText={statusText[state.status]}
                />
            )}
        </>
    );
    const plan = (
        <div
            key={inputEpoch}
            onFocusCapture={(event) => {
                if ((event.target as HTMLElement).matches('input,textarea,select') && (event.target as HTMLElement).closest('form')) {
                    session.hold();
                }
            }}
        >
            {tab === 'plan' && !phase && (
                <EditorPanel
                    editor={editor}
                    project={state.project}
                    session={session}
                    state={{ saveState: state.draft ? 'dirty' : 'saved', canUndo: state.canUndo, canRedo: state.canRedo }}
                    statusText={statusText[state.status]}
                    disabled={disabled}
                />
            )}
            {!phase && (
                <ManagementPanel
                    project={state.project}
                    map={map}
                    change={session.change}
                    disabled={disabled || editor.hasDraft || editor.hasUnsavedForm}
                />
            )}
        </div>
    );
    return (
        <WorkspaceShell
            revealKey={editor.selected ? `${editor.selected.id}:${editor.selected.version}` : undefined}
            title={state.project?.name ?? 'Gemeinsamer Plan'}
            subtitle={`${state.role === 'viewer' ? 'Mitglied' : state.role === 'owner' ? 'Eigentümer' : 'Admin'} · Gemeinsamer Plan`}
            status={state.status === 'live' ? 'Verbunden' : state.status === 'offline' ? 'Offline' : 'Abgleich offen'}
            map={
                <MapView
                    onViewport={onViewport}
                    mapPackage={maps.current}
                    onReady={setMap}
                    fix={gps.fix}
                    stale={gps.stale}
                    follow={follow}
                    onExplore={pauseFollow}
                />
            }
            tab={tab}
            blocked={editor.hasDraft || editor.hasUnsavedForm || !!phase || presentation.following || presentation.isLeader}
            onTab={(next) => {
                editor.cancel();
                editor.setEditing(next === 'plan' && !disabled);
                setTab(next);
            }}
            panels={{ field, plan, briefing, maps: mapTools, project: projectTools }}
            quick={
                <button
                    className="map-action"
                    onClick={() => {
                        setFollow(true);
                        gps.startGps();
                    }}
                >
                    ◎ Meine Position
                </button>
            }
            alert={
                editor.hasUnsavedForm ? (
                    <>
                        <span>Angaben noch nicht übernommen</span>
                        <button onClick={editor.cancel}>Verwerfen</button>
                    </>
                ) : editor.hasDraft ? (
                    <>
                        <span>Zeichnung läuft</span>
                        <button onClick={() => editor.finish()}>Fertig</button>
                        <button onClick={editor.cancel}>Abbrechen</button>
                    </>
                ) : state.draft || state.held || state.error || lockError ? (
                    <>
                        <span>{statusText[state.status]}</span>
                        <button disabled={!!phase || presentation.following || presentation.isLeader} onClick={() => setTab('project')}>
                            Abgleich öffnen
                        </button>
                    </>
                ) : undefined
            }
        />
    );
}
