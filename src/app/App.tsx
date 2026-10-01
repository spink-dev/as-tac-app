import CatalogPanel from '../features/catalog/CatalogPanel';
import StudioPanel from '../features/catalog/StudioPanel';
import WorkspaceShell, { type WorkspaceTab } from '../features/workspace/WorkspaceShell';
import OnlineWorkspace, { type OnlineTarget } from '../features/online/OnlineWorkspace';
import OnlinePanel from '../features/online/OnlinePanel';
import PortablePanel from '../features/portable/PortablePanel';
import { de } from '../i18n/de';
import { version } from '../../package.json';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import MapView from '../features/map/MapView';
import { useLocation } from '../core/location/useLocation';
import { outside } from '../core/location/position';
import { useOfflineApp } from '../core/useOfflineApp';
import areas from '../config/maps.json';
import { ProjectSession } from '../core/projects/session';
import ProjectPanel from '../features/projects/ProjectPanel';
import PackagePanel from '../features/packages/PackagePanel';
import { useMaps } from '../core/packages/useMaps';
import type { Bounds } from '../core/packages/maps';
import type { Map as LibreMap } from 'maplibre-gl';
import { useEditor } from '../features/editor/useEditor';
import EditorPanel from '../features/editor/EditorPanel';
import ManagementPanel from '../features/briefing/ManagementPanel';
import BriefingPanel from '../features/briefing/BriefingPanel';
import type { Phase } from '../core/projects/model';

export default function App() {
    const [target, setTarget] = useState<OnlineTarget | null>(null);
    const close = useCallback(() => setTarget(null), []);
    return target ? <OnlineWorkspace target={target} close={close} /> : <LocalApp onOpen={setTarget} />;
}
function LocalApp({ onOpen }: { onOpen: (target: OnlineTarget) => void }) {
    const [tab, setTab] = useState<WorkspaceTab>('field');
    const [areaId, setAreaId] = useState(areas[0].id);
    const [session] = useState(() => new ProjectSession());
    const projects = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const selectedAreaId = projects.project?.mapPackageId ?? areaId;
    const maps = useMaps(selectedAreaId);
    const area = maps.areas.find((item) => item.id === selectedAreaId);
    const [viewport, setViewport] = useState<Bounds | null>(null);
    const [packageBusy, setPackageBusy] = useState(false);
    const [follow, setFollow] = useState(true);
    const pauseFollow = useCallback(() => setFollow(false), []);
    const [mapInstance, setMapInstance] = useState<LibreMap | null>(null);
    const [briefingPhase, setBriefingPhase] = useState<Phase | null>(null);
    const editor = useEditor(
        mapInstance,
        maps.current?.id === selectedAreaId ? projects.project : null,
        session.change,
        pauseFollow,
        briefingPhase?.visibleElementIds ?? null,
    );
    const handleBriefingPhase = useCallback(
        (phase: Phase | null) => {
            setBriefingPhase(phase);
            if (phase) {
                editor.cancel();
                editor.setEditing(false);
                editor.setVisible(true);
                pauseFollow();
            }
        },
        [editor.cancel, editor.setEditing, editor.setVisible, pauseFollow],
    );
    useEffect(() => {
        editor.setEditing(tab === 'plan' && !!projects.project && !projects.readOnly);
    }, [tab, projects.project?.id, projects.readOnly, editor.setEditing]);
    const drawingPending = useRef(false);
    drawingPending.current = packageBusy || editor.hasDraft || editor.hasUnsavedForm || !!briefingPhase;
    const canReload = useCallback(
        () => session.canLeave() && !packageBusy && !(editor.hasDraft || editor.hasUnsavedForm) && !briefingPhase,
        [session, packageBusy, editor.hasDraft || editor.hasUnsavedForm, briefingPhase],
    );
    const selectArea = (id: string) => {
        if (projects.project) {
            session.change([{ kind: 'project', mapPackageId: id }]);
        } else {
            setAreaId(id);
        }
    };
    useEffect(() => {
        void session.start();
        const guard = (event: BeforeUnloadEvent) => {
            if (!session.canLeave() || drawingPending.current) {
                event.preventDefault();
            }
        };
        const flushWhenHidden = () => {
            if (document.visibilityState === 'hidden') {
                void session.flush();
            }
        };
        document.addEventListener('visibilitychange', flushWhenHidden);
        window.addEventListener('beforeunload', guard);
        return () => {
            window.removeEventListener('beforeunload', guard);
            document.removeEventListener('visibilitychange', flushWhenHidden);
            session.dispose();
        };
    }, [session]);
    const { fix, now, gps, active, stale, startGps, stopGps } = useLocation();
    const { online, offline, offlineText, registration, update, storage, verify, checkStorage, applyUpdate } = useOfflineApp(canReload);
    const map = (
        <MapView
            mapPackage={maps.current}
            onViewport={setViewport}
            onReady={setMapInstance}
            fix={fix}
            stale={stale}
            follow={follow}
            onExplore={pauseFollow}
        />
    );
    const plan = (
        <>
            {!projects.project && (
                <div className="empty-state">
                    <h2>Ein Plan beginnt mit einem Gebiet.</h2>
                    <p>Öffne eine vorbereitete Eventkarte oder erstelle dein eigenes Projekt.</p>
                    <button onClick={() => setTab('project')}>Projekt anlegen</button>
                    <button onClick={() => setTab('maps')}>Karten entdecken</button>
                </div>
            )}
            {tab === 'plan' && !briefingPhase && (
                <EditorPanel
                    editor={editor}
                    project={projects.project}
                    session={session}
                    state={projects}
                    disabled={projects.readOnly || projects.busy || packageBusy || maps.loading || maps.error}
                />
            )}

            {!briefingPhase && (
                <ManagementPanel
                    project={projects.project}
                    map={mapInstance}
                    change={session.change}
                    disabled={projects.readOnly || projects.busy || editor.hasDraft || editor.hasUnsavedForm || packageBusy}
                />
            )}
        </>
    );
    const briefing = (
        <>
            {' '}
            <BriefingPanel
                readOnly={projects.readOnly}
                project={projects.project}
                map={mapInstance}
                change={session.change}
                onPhase={handleBriefingPhase}
                disabled={!session.canLeave() || editor.hasDraft || editor.hasUnsavedForm || packageBusy || maps.loading || maps.error}
                pauseFollow={pauseFollow}
            />
        </>
    );
    const mapTools = (
        <>
            <CatalogPanel session={session} disabled={!canReload()} busyChanged={setPackageBusy} refresh={maps.refresh} />{' '}
            <section>
                <label htmlFor="area">{de.app.area}</label>
                <select
                    id="area"
                    value={selectedAreaId}
                    disabled={
                        projects.readOnly || projects.busy || packageBusy || editor.hasDraft || editor.hasUnsavedForm || !!briefingPhase
                    }
                    onChange={(event) => selectArea(event.target.value)}
                >
                    {!area && <option value={selectedAreaId}>{selectedAreaId}</option>}
                    {maps.areas.map((item) => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                </select>
                {maps.loading && <p role="status">{de.packages.loading}</p>}
                {maps.error && <p role="alert">{de.packages.missing}</p>}
                <h2>{offline.ready ? de.app.available : de.app.prepare}</h2>
                <p role="status">{offlineText}</p>
                <div className="actions">
                    <button onClick={() => verify()}>{de.app.verify}</button>
                    <button onClick={checkStorage}>{de.app.storage}</button>
                </div>
                {storage && <p>{storage}</p>}
                {update && (
                    <button disabled={!canReload()} onClick={applyUpdate}>
                        {de.app.update}
                    </button>
                )}
                {registration && !offline.ready && <button onClick={() => verify(true)}>{de.app.repair}</button>}
            </section>
            <div className="workflow-note">
                <strong>Dein eigenes Gebiet</strong>
                <p>Ausschnitt auf der Karte wählen, Kartendaten herunterladen oder eine vorhandene Datei importieren.</p>
            </div>
            <PackagePanel
                current={maps.current}
                viewport={viewport}
                refresh={maps.refresh}
                select={selectArea}
                disabled={
                    projects.readOnly || packageBusy || !session.canLeave() || editor.hasDraft || editor.hasUnsavedForm || !!briefingPhase
                }
                busyChanged={setPackageBusy}
            />
        </>
    );
    const projectTools = (
        <>
            {projects.project && (
                <StudioPanel
                    key={projects.project.id}
                    project={projects.project}
                    map={maps.current}
                    change={session.change}
                    disabled={projects.readOnly || projects.busy || packageBusy}
                    saved={session.canLeave()}
                />
            )}{' '}
            <ProjectPanel
                session={session}
                state={projects}
                locked={packageBusy || editor.hasDraft || editor.hasUnsavedForm || !!briefingPhase}
                areaId={selectedAreaId}
            />{' '}
            <PortablePanel
                session={session}
                state={projects}
                map={maps.current}
                refresh={maps.refresh}
                busyChanged={setPackageBusy}
                disabled={!session.canLeave() || packageBusy || editor.hasDraft || editor.hasUnsavedForm || !!briefingPhase}
            />{' '}
            <OnlinePanel onOpen={onOpen} locked={!canReload()} />
            <details>
                <summary>{de.app.sources}</summary>
                <p>AS-TAC · v{version}</p>
                <p>{area?.name ?? selectedAreaId}</p>
                <p>
                    © OpenStreetMap contributors · ODbL 1.0. <a href="/licenses/ODbL-1.0.txt">{de.app.license}</a>
                </p>
                <p>
                    {de.app.thanks} <a href="https://github.com/rwolffgang/FieldMaps">FieldMaps / @rwolffgang</a> {de.app.reference}
                </p>
                <p>
                    <a href="/licenses/CREDITS.md">{de.app.provenance}</a> · <a href="/licenses/dependencies.txt">{de.app.libraries}</a>
                </p>
            </details>
        </>
    );
    const field = (
        <>
            {' '}
            <section>
                <h2>{stale ? de.location.last : de.location.title}</h2>
                <p role="status">{gps}</p>
                {fix && (
                    <p className="coordinates">
                        {fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)}
                        <br />± {Math.round(fix.accuracy)} m ·{' '}
                        {de.location.age(Math.max(0, Math.floor((now - fix.timestamp) / 1000)), stale)}
                    </p>
                )}
                {fix && !stale && fix.accuracy > 50 && <p role="status">{de.location.imprecise}</p>}
                {fix && area && outside(fix, area.bounds) && <p role="status">{de.location.outside}</p>}
                <div className="actions">
                    <button
                        className="primary"
                        onClick={() => {
                            setFollow(true);
                            startGps();
                        }}
                    >
                        {active ? de.location.retry : de.location.start}
                    </button>
                    {active && <button onClick={stopGps}>{de.location.stop}</button>}
                    {fix && (
                        <button
                            onClick={() => {
                                setFollow(!follow);
                            }}
                        >
                            {follow ? de.location.pause : de.location.follow}
                        </button>
                    )}
                </div>
                <p className="muted">{de.location.privacy}</p>
            </section>
            {!projects.project && <p>Unter Karten findest du vorbereitete Gebiete. Unter Projekt legst du einen eigenen Plan an.</p>}
            {tab === 'field' && projects.project && (
                <EditorPanel editor={editor} project={projects.project} session={session} state={projects} disabled />
            )}
        </>
    );
    return (
        <WorkspaceShell
            revealKey={editor.selected ? `${editor.selected.id}:${editor.selected.version}` : undefined}
            title={projects.project?.name ?? area?.name ?? 'Gebiet wählen'}
            subtitle={area?.name ?? selectedAreaId}
            status={online ? 'Netz verfügbar' : 'Offline'}
            map={map}
            tab={tab}
            blocked={editor.hasDraft || editor.hasUnsavedForm || packageBusy || !!briefingPhase}
            onTab={(next) => {
                editor.cancel();
                editor.setEditing(next === 'plan' && !!projects.project && !projects.readOnly);
                setTab(next);
            }}
            panels={{ field, plan, briefing, maps: mapTools, project: projectTools }}
            quick={
                <button
                    className="map-action"
                    onClick={() => {
                        setFollow(true);
                        startGps();
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
                ) : maps.error ? (
                    'Gebiet nicht verfügbar. Unter Karten herunterladen oder importieren.'
                ) : undefined
            }
        />
    );
}
