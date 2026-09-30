import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
import { accuracyRing, outside, STALE_MS, validFix, type Fix } from '../../core/location/position';
import { verifyOffline, type OfflineStatus } from '../../core/offline';

interface Package {
    name: string;
    bounds: [number, number, number, number];
    dataTimestamp: string;
    file: string;
    byteSize: number;
    featureCount: number;
}

export default function MapProbe() {
    const container = useRef<HTMLDivElement>(null);
    const map = useRef<LibreMap | null>(null);
    const marker = useRef<maplibregl.Marker | null>(null);
    const watch = useRef<number | null>(null);
    const following = useRef(true);
    const [follow, setFollow] = useState(true);
    const [fix, setFix] = useState<Fix | null>(null);
    const [now, setNow] = useState(Date.now());
    const [gps, setGps] = useState('GPS ist ausgeschaltet.');
    const [gpsError, setGpsError] = useState(false);
    const [active, setActive] = useState(false);
    const [areaId, setAreaId] = useState('mahlwinkel');
    const [area, setArea] = useState<Package | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState('');
    const [loadMs, setLoadMs] = useState<number | null>(null);
    const [online, setOnline] = useState(true);
    const [offline, setOffline] = useState<OfflineStatus>({ ready: false });
    const [offlineText, setOfflineText] = useState('Offline-Paket noch nicht geprüft.');
    const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
    const [update, setUpdate] = useState<ServiceWorker | null>(null);
    const [storage, setStorage] = useState('');

    function setFollowing(value: boolean) {
        following.current = value;
        setFollow(value);
    }

    useEffect(() => {
        const clock = window.setInterval(() => setNow(Date.now()), 1000);
        const connection = () => setOnline(navigator.onLine);
        connection();
        window.addEventListener('online', connection);
        window.addEventListener('offline', connection);
        return () => {
            clearInterval(clock);
            window.removeEventListener('online', connection);
            window.removeEventListener('offline', connection);
            if (watch.current !== null) {
                navigator.geolocation.clearWatch(watch.current);
            }
        };
    }, []);

    useEffect(() => {
        let disposed = false;
        const abort = new AbortController();
        const started = performance.now();
        setMapReady(false);
        setMapError('');
        setLoadMs(null);
        async function init() {
            try {
                const response = await fetch(`/maps/${areaId}.json`, { signal: abort.signal });
                if (!response.ok) {
                    throw new Error('Kartenmanifest fehlt.');
                }
                const pkg: Package = await response.json();
                if (disposed || !container.current) {
                    return;
                }
                setArea(pkg);
                const instance = new maplibregl.Map({
                    container: container.current,
                    bounds: [[pkg.bounds[0], pkg.bounds[1]], [pkg.bounds[2], pkg.bounds[3]]],
                    fitBoundsOptions: { padding: 30 },
                    style: {
                        version: 8,
                        sources: {
                            terrain: { type: 'geojson', data: pkg.file,
                                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
                        },
                        layers: [
                            { id: 'background', type: 'background', paint: { 'background-color': '#ecebdf' } },
                            { id: 'areas', type: 'fill', source: 'terrain', filter: ['==', '$type', 'Polygon'],
                                paint: { 'fill-color': ['case', ['has', 'building'], '#b7b5a8',
                                    ['==', ['get', 'natural'], 'water'], '#a2c6d1', '#ced9bb'], 'fill-opacity': 0.85 } },
                            { id: 'water', type: 'line', source: 'terrain', filter: ['has', 'waterway'],
                                paint: { 'line-color': '#77a6b4', 'line-width': 2 } },
                            { id: 'roads-outline', type: 'line', source: 'terrain', filter: ['has', 'highway'],
                                paint: { 'line-color': '#9e9b86', 'line-width': 5 } },
                            { id: 'roads', type: 'line', source: 'terrain', filter: ['has', 'highway'],
                                paint: { 'line-color': '#fffdf2', 'line-width': 3 } },
                        ],
                    },
                    attributionControl: { compact: false },
                });
                map.current = instance;
                instance.addControl(new maplibregl.NavigationControl(), 'top-right');
                instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
                instance.on('dragstart', () => setFollowing(false));
                instance.on('error', (event) => {
                    setMapError(`Kartenfehler: ${event.error.message}`);
                });
                instance.on('load', async () => {
                    try {
                        const dataResponse = await fetch(pkg.file, { signal: abort.signal });
                        if (!dataResponse.ok) {
                            throw new Error('Gebietsdaten fehlen.');
                        }
                        const data: GeoJSON.FeatureCollection = await dataResponse.json();
                        if (disposed) {
                            return;
                        }
                        const labels: { element: HTMLElement; coordinates: [number, number] }[] = [];
                        // DOM text uses the installed system font; no remote glyphs or sprites.
                        for (const feature of data.features) {
                            if (!feature.properties?.name || !['Point', 'LineString'].includes(feature.geometry.type)) {
                                continue;
                            }
                            const geometry = feature.geometry as GeoJSON.Point | GeoJSON.LineString;
                            const coordinates = geometry.type === 'Point' ? geometry.coordinates
                                : geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
                            if (outside({ longitude: coordinates[0], latitude: coordinates[1], accuracy: 0, timestamp: 1 }, pkg.bounds)) {
                                continue;
                            }
                            const label = document.createElement('span');
                            label.className = 'map-label';
                            label.textContent = `${feature.properties.natural === 'peak' ? '▲' : '●'} ${feature.properties.name}`;
                            new maplibregl.Marker({ element: label, anchor: 'bottom' })
                                .setLngLat(coordinates as [number, number]).addTo(instance);
                            labels.push({ element: label, coordinates: coordinates as [number, number] });
                        }
                        const areaLabel = document.createElement('span');
                        areaLabel.className = 'map-label';
                        areaLabel.textContent = `◇ Testgebiet ${pkg.name}`;
                        new maplibregl.Marker({ element: areaLabel, anchor: 'bottom' })
                            .setLngLat([(pkg.bounds[0] + pkg.bounds[2]) / 2, (pkg.bounds[1] + pkg.bounds[3]) / 2]).addTo(instance);
                        const placeLabels = () => {
                            const occupied: { x: number; y: number; width: number; height: number }[] = [];
                            for (const label of labels) {
                                const point = instance.project(label.coordinates);
                                const width = label.element.offsetWidth + 12;
                                const height = label.element.offsetHeight + 8;
                                const box = { x: point.x - width / 2, y: point.y - height, width, height };
                                const hidden = box.x < 0 || box.y < 85 || box.x + width > instance.getContainer().clientWidth - 55
                                    || box.y + height > instance.getContainer().clientHeight - 45
                                    || occupied.some((other) => box.x < other.x + other.width && box.x + width > other.x
                                        && box.y < other.y + other.height && box.y + height > other.y);
                                label.element.style.visibility = hidden ? 'hidden' : 'visible';
                                if (!hidden) {
                                    occupied.push(box);
                                }
                            }
                        };
                        instance.on('move', placeLabels);
                        instance.on('resize', placeLabels);
                        placeLabels();
                        instance.addSource('accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                        instance.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy',
                            paint: { 'fill-color': '#176b89', 'fill-opacity': 0.16 } });
                        instance.addLayer({ id: 'accuracy-line', type: 'line', source: 'accuracy',
                            paint: { 'line-color': '#176b89', 'line-width': 2 } });
                        setMapReady(true);
                        setLoadMs(Math.round(performance.now() - started));
                    } catch (error) {
                        if (!disposed) {
                            setMapError(String(error));
                        }
                    }
                });
            } catch (error) {
                if (!disposed) {
                    setMapError(`Karte konnte nicht starten (WebGL/Dateien prüfen): ${String(error)}`);
                }
            }
        }
        void init();
        return () => {
            disposed = true;
            abort.abort();
            marker.current?.remove();
            marker.current = null;
            map.current?.remove();
            map.current = null;
        };
    }, [areaId]);

    useEffect(() => {
        if (!import.meta.env.PROD) {
            setOfflineText('Entwicklung: Offline-Prüfung nur im Produktionsbuild.');
            return;
        }
        if (!isSecureContext || !('serviceWorker' in navigator)) {
            setOfflineText('Offline-Nutzung benötigt HTTPS und Service-Worker-Unterstützung.');
            return;
        }
        let disposed = false;
        const verify = async () => {
            const status = await verifyOffline();
            const currentRegistration = await navigator.serviceWorker.getRegistration();
            if (!disposed) {
                setUpdate(currentRegistration?.waiting ?? null);
                setOffline(status);
                setOfflineText(status.ready ? 'Offline bereit · Dateien geprüft' : (status.error ?? 'Offline-Paket unvollständig.'));
            }
        };
        navigator.serviceWorker.addEventListener('controllerchange', verify);
        const visibility = () => {
            if (document.visibilityState === 'visible') {
                void verify();
            }
        };
        document.addEventListener('visibilitychange', visibility);
        void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
            if (disposed) {
                return;
            }
            setRegistration(reg);
            setUpdate(navigator.serviceWorker.controller ? reg.waiting : null);
            setOfflineText('Offline-Paket wird geladen und geprüft …');
            reg.addEventListener('updatefound', () => {
                const installing = reg.installing;
                installing?.addEventListener('statechange', () => {
                    if (installing.state === 'installed') {
                        setUpdate(navigator.serviceWorker.controller ? reg.waiting : null);
                    }
                    if (installing.state === 'redundant') {
                        setOfflineText('Installation fehlgeschlagen. Verbindung oder Speicher prüfen und erneut laden.');
                    }
                });
            });
            if (navigator.serviceWorker.controller) {
                void verify();
            }
        }).catch((error) => setOfflineText(`Offline-Installation fehlgeschlagen: ${String(error)}`));
        return () => {
            disposed = true;
            navigator.serviceWorker.removeEventListener('controllerchange', verify);
            document.removeEventListener('visibilitychange', visibility);
        };
    }, []);

    const stale = fix !== null && (now - fix.timestamp > STALE_MS || gpsError || !active);
    useEffect(() => {
        if (!mapReady || !map.current || !fix) {
            return;
        }
        const instance = map.current;
        if (!marker.current) {
            const dot = document.createElement('div');
            dot.className = 'gps-dot';
            marker.current = new maplibregl.Marker({ element: dot })
                .setLngLat([fix.longitude, fix.latitude]).addTo(instance);
        }
        marker.current.setLngLat([fix.longitude, fix.latitude]);
        marker.current.getElement().classList.toggle('stale', stale);
        marker.current.getElement().setAttribute('aria-label', stale ? 'Letzte bekannte Position' : 'Eigene Position');
        (instance.getSource('accuracy') as GeoJSONSource).setData(accuracyRing(fix));
        instance.setPaintProperty('accuracy-fill', 'fill-color', stale ? '#707070' : '#176b89');
        instance.setPaintProperty('accuracy-line', 'line-color', stale ? '#707070' : '#176b89');
        if (following.current && !stale && area && !outside(fix, area.bounds)) {
            instance.easeTo({ center: [fix.longitude, fix.latitude], duration: 300 });
        }
    }, [fix, stale, mapReady, area]);

    function startGps() {
        if (!isSecureContext || !navigator.geolocation) {
            setGps('GPS benötigt HTTPS und Standortunterstützung.');
            setGpsError(true);
            return;
        }
        if (watch.current !== null) {
            navigator.geolocation.clearWatch(watch.current);
        }
        setGps('Warte auf GPS-Fix …');
        setGpsError(false);
        setActive(true);
        setFollowing(true);
        watch.current = navigator.geolocation.watchPosition((position) => {
            const next = { longitude: position.coords.longitude, latitude: position.coords.latitude,
                accuracy: position.coords.accuracy, timestamp: position.timestamp };
            if (!validFix(next)) {
                setGps('Ungültiger GPS-Fix.');
                setGpsError(true);
                return;
            }
            setFix(next);
            setNow(Date.now());
            setGps('GPS-Fix empfangen');
            setGpsError(false);
        }, (error) => {
            setGps(error.code === 1 ? 'Standortfreigabe verweigert. In den Browser-Einstellungen erlauben.'
                : error.code === 3 ? 'GPS-Zeitlimit: noch kein neuer Fix. Unter freiem Himmel erneut versuchen.'
                    : 'GPS ist derzeit nicht verfügbar.');
            setGpsError(true);
            if (error.code === 1) {
                if (watch.current !== null) {
                    navigator.geolocation.clearWatch(watch.current);
                    watch.current = null;
                }
                setActive(false);
            }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    }

    function stopGps() {
        if (watch.current !== null) {
            navigator.geolocation.clearWatch(watch.current);
            watch.current = null;
        }
        setActive(false);
        setGps('GPS gestoppt · letzte Position bleibt als alt markiert.');
    }

    async function checkStorage() {
        try {
            const persisted = await navigator.storage?.persist?.();
            const estimate = await navigator.storage?.estimate?.();
            setStorage(`${persisted ? 'Dauerhafter Speicher gewährt' : 'Speicher kann vom Browser gelöscht werden'} · ${Math.round((estimate?.usage ?? 0) / 1024)} KiB belegt`);
        } catch {
            setStorage('Speicherstatus konnte nicht ermittelt werden.');
        }
    }

    function applyUpdate() {
        if (update) {
            navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
            update.postMessage({ type: 'ACTIVATE' });
        }
    }

    return <main className="probe">
        <header><div><span className="eyebrow">AS-TAC / MOBILER PRÜFSTAND</span><h1>Karte im Gelände.</h1></div>
            <span className="connection">{online ? 'Netz verfügbar' : 'Ohne Netz'}</span></header>
        <section className="map-wrap" aria-label="Offline-Karte">
            <div ref={container} className="map" />
            <div className="map-caption">{area?.name ?? 'Karte wird geladen …'}<span>OSM · lokales Gebiet</span></div>
            {mapError && <p className="map-error" role="alert">{mapError}</p>}
        </section>
        <aside className="panel">
            <section><label htmlFor="area">Vorbereitetes Gebiet</label><select id="area" value={areaId} onChange={(event) => setAreaId(event.target.value)}><option value="mahlwinkel">Mahlwinkel · Airsoft-Feld</option><option value="benglen">Zürich · Benglen</option></select><span className="eyebrow">01 / OFFLINE</span><h2>{offline.ready ? 'Bereit für den Netztest' : 'Karte vorbereiten'}</h2>
                <p role="status">{offlineText}</p>
                <p className="muted">Einmal online vollständig laden. Danach App schliessen, Flugmodus einschalten und erneut öffnen.</p>
                <div className="actions"><button onClick={async () => {
                    const status = await verifyOffline();
                    setOffline(status);
                    setOfflineText(status.ready ? 'Offline bereit · Dateien geprüft' : (status.error ?? 'Unvollständig'));
                }}>Dateien prüfen</button><button onClick={checkStorage}>Speicher sichern</button></div>
                {storage && <p>{storage}</p>}
                {update && <button onClick={applyUpdate}>Update installieren und neu starten</button>}
                {registration && !offline.ready && <button onClick={async () => {
                    setOfflineText('Offline-Paket wird repariert …');
                    if (!navigator.serviceWorker.controller) {
                        location.reload();
                        return;
                    }
                    const status = await verifyOffline(true);
                    setOffline(status);
                    setOfflineText(status.ready ? 'Offline bereit · Dateien geprüft' : (status.error ?? 'Reparatur fehlgeschlagen.'));
                }}>Offline-Paket reparieren</button>}
            </section>
            <section><span className="eyebrow">02 / EIGENE POSITION</span><h2>{stale ? 'Letzte bekannte Position' : 'Standort auf dem Gerät'}</h2>
                <p role="status">{gps}</p>
                {fix && <p className="coordinates">{fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)}<br />
                    ± {Math.round(fix.accuracy)} m · Fix vor {Math.max(0, Math.floor((now - fix.timestamp) / 1000))} s{stale ? ' · VERALTET' : ''}</p>}
                {fix && area && outside(fix, area.bounds) && <p role="status">Ausserhalb des geladenen Gebiets. Der Kartenausschnitt bleibt sichtbar.</p>}
                <div className="actions"><button className="primary" onClick={startGps}>{active ? 'GPS erneut versuchen' : 'Meine Position'}</button>
                    {active && <button onClick={stopGps}>GPS stoppen</button>}
                    {fix && <button onClick={() => {
                        setFollowing(!follow);
                        if (!follow && !stale && area && !outside(fix, area.bounds)) {
                            map.current?.easeTo({ center: [fix.longitude, fix.latitude] });
                        }
                    }}>{follow ? 'Folgen pausieren' : 'Position folgen'}</button>}</div>
                <p className="muted">Keine Übertragung oder Speicherung der Position. GPS benötigt Freigabe; ein Fix ohne Internet ist nicht garantiert. Nur Vordergrundbetrieb.</p>
            </section>
            <details><summary>Prüfdaten & Credits</summary>
                <p>Kartenstart: {loadMs === null ? 'ausstehend' : `${loadMs} ms`} · {mapReady ? 'Renderer bereit' : 'Renderer wartet'}</p>
                <p>Paket: {area ? `${area.featureCount} Objekte · ${Math.round(area.byteSize / 1024)} KiB GeoJSON` : 'ausstehend'}<br />Datenstand: {area?.dataTimestamp}</p>
                <p>App-Paket: {offline.bytes ? `${Math.round(offline.bytes / 1024)} KiB` : 'ungeprüft'} · Build {offline.version ?? 'Entwicklung'}</p>
                <p>Labels und Symbole: lokale Systemschrift, keine Font-/Sprite-Downloads.</p>
                <p>© OpenStreetMap contributors · ODbL 1.0. <a href="/licenses/ODbL-1.0.txt">Lokaler Lizenztext</a></p>
                <p>Danke an <a href="https://github.com/rwolffgang/FieldMaps">FieldMaps / @rwolffgang</a> für die Offline-/GPS-Referenz. Kein Referenzcode kopiert.</p>
                <p><a href="/licenses/CREDITS.md">Herkunft</a> · <a href="/licenses/dependencies.txt">Bibliothekslizenzen</a></p>
                <p>AST-001: Technischer Prüfstand. Reale iOS-/Android-Abnahme noch offen.</p>
            </details>
        </aside>
    </main>;
}
