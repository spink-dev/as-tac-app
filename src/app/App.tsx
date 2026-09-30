import { de } from '../i18n/de';
import { useCallback, useState } from 'react';
import MapView from '../features/map/MapView';
import { useLocation } from '../core/location/useLocation';
import { outside } from '../core/location/position';
import { useOfflineApp } from '../core/useOfflineApp';
import areas from '../config/maps.json';

export default function App() {
    const [areaId, setAreaId] = useState(areas[0].id);
    const area = areas.find((item) => item.id === areaId)!;
    const [follow, setFollow] = useState(true);
    const pauseFollow = useCallback(() => setFollow(false), []);
    const { fix, now, gps, active, stale, startGps, stopGps } = useLocation();
    const { online, offline, offlineText, registration, update, storage, verify, checkStorage, applyUpdate } = useOfflineApp();
    return <main className="app-shell">
        <header><div><span className="eyebrow">AS-TAC</span><h1>{de.app.title}</h1></div>
            <span className="connection">{online ? de.app.online : de.app.offline}</span></header>
        <MapView areaId={areaId} fix={fix} stale={stale} follow={follow} onExplore={pauseFollow} />
        <aside className="panel">
            <section><label htmlFor="area">{de.app.area}</label><select id="area" value={areaId} onChange={(event) => setAreaId(event.target.value)}>{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><h2>{offline.ready ? de.app.available : de.app.prepare}</h2>
                <p role="status">{offlineText}</p>
                <div className="actions"><button onClick={() => verify()}>{de.app.verify}</button><button onClick={checkStorage}>{de.app.storage}</button></div>
                {storage && <p>{storage}</p>}
                {update && <button onClick={applyUpdate}>{de.app.update}</button>}
                {registration && !offline.ready && <button onClick={() => verify(true)}>{de.app.repair}</button>}
            </section>
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
                <p>{area.name}</p>
                <p>© OpenStreetMap contributors · ODbL 1.0. <a href="/licenses/ODbL-1.0.txt">{de.app.license}</a></p>
                <p>{de.app.thanks} <a href="https://github.com/rwolffgang/FieldMaps">FieldMaps / @rwolffgang</a> {de.app.reference}</p>
                <p><a href="/licenses/CREDITS.md">{de.app.provenance}</a> · <a href="/licenses/dependencies.txt">{de.app.libraries}</a></p>
            </details>
        </aside>
    </main>;
}
