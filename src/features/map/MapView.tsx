import { de } from '../../i18n/de';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { accuracyRing, outside, type Fix } from '../../core/location/position';

maplibregl.setWorkerUrl(workerUrl);

interface Package {
    name: string;
    bounds: [number, number, number, number];
    dataTimestamp: string;
    file: string;
    byteSize: number;
    featureCount: number;
}

export default function MapView({ areaId, fix, stale, follow, onExplore }: {
    areaId: string;
    fix: Fix | null;
    stale: boolean;
    follow: boolean;
    onExplore: () => void;
}) {
    const container = useRef<HTMLDivElement>(null);
    const map = useRef<LibreMap | null>(null);
    const marker = useRef<maplibregl.Marker | null>(null);
    const [area, setArea] = useState<Package | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState('');
    useEffect(() => {
        let disposed = false;
        const abort = new AbortController();
        setMapReady(false);
        setMapError('');
        async function init() {
            try {
                const response = await fetch(`/maps/${areaId}.json`, { signal: abort.signal });
                if (!response.ok) {
                    throw new Error(de.map.missingManifest);
                }
                const pkg: Package = await response.json();
                // Load through the controlled page, not the map worker: offline
                // worker requests can bypass the service-worker cache on mobile.
                const dataResponse = await fetch(pkg.file, { signal: abort.signal });
                if (!dataResponse.ok) {
                    throw new Error(de.map.missingData);
                }
                const data: GeoJSON.FeatureCollection = await dataResponse.json();
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
                            terrain: { type: 'geojson', data,
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
                instance.on('dragstart', onExplore);
                instance.on('error', (event) => {
                    setMapError(de.map.error(event.error.message));
                });
                instance.on('load', () => {
                    try {
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
                        areaLabel.textContent = `◇ ${pkg.name}`;
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
                    } catch (error) {
                        if (!disposed) {
                            setMapError(String(error));
                        }
                    }
                });
            } catch (error) {
                if (!disposed) {
                    setMapError(de.map.failed(error));
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
    }, [areaId, onExplore]);

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
        marker.current.getElement().setAttribute('aria-label', stale ? de.location.last : de.location.own);
        (instance.getSource('accuracy') as GeoJSONSource).setData(accuracyRing(fix));
        instance.setPaintProperty('accuracy-fill', 'fill-color', stale ? '#707070' : '#176b89');
        instance.setPaintProperty('accuracy-line', 'line-color', stale ? '#707070' : '#176b89');
        if (follow && !stale && area && !outside(fix, area.bounds)) {
            instance.easeTo({ center: [fix.longitude, fix.latitude], duration: 300 });
        }
    }, [fix, stale, mapReady, area, follow]);

    return (
        <section className="map-wrap" aria-label={de.map.label}>
            <div ref={container} className="map" aria-busy={!mapReady} />
            <div className="map-caption">{area?.name ?? de.map.loading}<span>{de.map.local}</span></div>
            {mapError && <p className="map-error" role="alert">{mapError}</p>}
        </section>
    );
}
