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

export default function App() {
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
    const editor = useEditor(mapInstance, maps.current?.id === selectedAreaId ? projects.project : null, session.change, pauseFollow);
    const drawingPending = useRef(false);
    drawingPending.current = editor.hasDraft;
    const canReload = useCallback(() => session.canLeave() && !packageBusy && !editor.hasDraft, [session, packageBusy, editor.hasDraft]);
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
    return <main className="app-shell">
        <header><div><span className="eyebrow">AS-TAC</span><h1>{de.app.title}</h1></div>
            <span className="connection">{online ? de.app.online : de.app.offline}</span></header>
        <MapView mapPackage={maps.current} onViewport={setViewport} onReady={setMapInstance} fix={fix} stale={stale} follow={follow} onExplore={pauseFollow} />
        <aside className="panel">
            <EditorPanel editor={editor} project={projects.project} session={session} state={projects} disabled={projects.busy || packageBusy || maps.loading || maps.error} />
            <ProjectPanel session={session} state={{ ...projects, busy: projects.busy || packageBusy || editor.hasDraft }} areaId={selectedAreaId} />
            <section><label htmlFor="area">{de.app.area}</label><select id="area" value={selectedAreaId} disabled={projects.busy || packageBusy || editor.hasDraft} onChange={(event) => selectArea(event.target.value)}>{!area && <option value={selectedAreaId}>{selectedAreaId}</option>}{maps.areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                {maps.loading && <p role="status">{de.packages.loading}</p>}
                {maps.error && <p role="alert">{de.packages.missing}</p>}
                <h2>{offline.ready ? de.app.available : de.app.prepare}</h2>
                <p role="status">{offlineText}</p>
                <div className="actions"><button onClick={() => verify()}>{de.app.verify}</button><button onClick={checkStorage}>{de.app.storage}</button></div>
                {storage && <p>{storage}</p>}
                {update && <button disabled={!canReload()} onClick={applyUpdate}>{de.app.update}</button>}
                {registration && !offline.ready && <button onClick={() => verify(true)}>{de.app.repair}</button>}
            </section>
            <PackagePanel current={maps.current} viewport={viewport} refresh={maps.refresh} select={selectArea} disabled={!session.canLeave() || editor.hasDraft} busyChanged={setPackageBusy} />
            <section><h2>{stale ? de.location.last : de.location.title}</h2>
                <p role="status">{gps}</p>
                {fix && <p className="coordinates">{fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)}<br />
                    ± {Math.round(fix.accuracy)} m · {de.location.age(Math.max(0, Math.floor((now - fix.timestamp) / 1000)), stale)}</p>}
                {fix && area && outside(fix, area.bounds) && <p role="status">{de.location.outside}</p>}
                <div className="actions"><button className="primary" onClick={() => {
                    setFollow(true);
                    startGps();
                }}>{active ? de.location.retry : de.location.start}</button>
                    {active && <button onClick={stopGps}>{de.location.stop}</button>}
                    {fix && <button onClick={() => {
                        setFollow(!follow);
                    }}>{follow ? de.location.pause : de.location.follow}</button>}</div>
                <p className="muted">{de.location.privacy}</p>
            </section>
            <details><summary>{de.app.sources}</summary>
                <p>AS-TAC · v{version}</p>
                <p>{area?.name ?? selectedAreaId}</p>
                <p>© OpenStreetMap contributors · ODbL 1.0. <a href="/licenses/ODbL-1.0.txt">{de.app.license}</a></p>
                <p>{de.app.thanks} <a href="https://github.com/rwolffgang/FieldMaps">FieldMaps / @rwolffgang</a> {de.app.reference}</p>
                <p><a href="/licenses/CREDITS.md">{de.app.provenance}</a> · <a href="/licenses/dependencies.txt">{de.app.libraries}</a></p>
            </details>
        </aside>
    </main>;
}
