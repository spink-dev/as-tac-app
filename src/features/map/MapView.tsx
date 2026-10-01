import { useTheme } from '../appearance/theme';
import { palettes } from './palette';
import { installLabels } from './labels';
import { de } from '../../i18n/de';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { accuracyRing, outside, type Fix } from '../../core/location/position';

maplibregl.setWorkerUrl(workerUrl);

import type { Bounds, MapPackage } from '../../core/packages/maps';

export default function MapView({
    mapPackage,
    onViewport,
    onReady,
    fix,
    stale,
    follow,
    onExplore,
}: {
    mapPackage: MapPackage | null;
    onViewport: (bounds: Bounds) => void;
    onReady: (map: LibreMap | null) => void;
    fix: Fix | null;
    stale: boolean;
    follow: boolean;
    onExplore: () => void;
}) {
    const theme = useTheme();
    const themeRef = useRef(theme);
    themeRef.current = theme;
    const [labelOptions, setLabelOptions] = useState({
        roads: true,
        places: false,
    });
    const labelSettings = useRef(labelOptions);
    labelSettings.current = labelOptions;
    const labels = useRef<ReturnType<typeof installLabels> | null>(null);
    useEffect(() => {
        labels.current?.update(labelOptions);
    }, [labelOptions]);
    const container = useRef<HTMLDivElement>(null);
    const map = useRef<LibreMap | null>(null);
    const marker = useRef<maplibregl.Marker | null>(null);
    const [area, setArea] = useState<MapPackage | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState('');
    useEffect(() => {
        if (!mapPackage) {
            return;
        }
        let disposed = false;
        const abort = new AbortController();
        setMapReady(false);
        setMapError('');
        async function init() {
            try {
                // Already verified and loaded in the controlled page; never fetch GeoJSON in a worker.
                const pkg = mapPackage!;
                const data = pkg.data;
                if (disposed || !container.current) {
                    return;
                }
                setArea(pkg);
                const palette = palettes[themeRef.current];
                const instance = new maplibregl.Map({
                    container: container.current,
                    bounds: [
                        [pkg.bounds[0], pkg.bounds[1]],
                        [pkg.bounds[2], pkg.bounds[3]],
                    ],
                    fitBoundsOptions: { padding: 30 },
                    style: {
                        version: 8,
                        transition: { duration: 0, delay: 0 },
                        sources: {
                            terrain: {
                                type: 'geojson',
                                data,
                                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
                            },
                        },
                        layers: [
                            {
                                id: 'background',
                                type: 'background',
                                paint: { 'background-color': palette.background },
                            },
                            {
                                id: 'areas',
                                type: 'fill',
                                source: 'terrain',
                                filter: ['==', '$type', 'Polygon'],
                                paint: {
                                    'fill-color': [
                                        'case',
                                        ['has', 'building'],
                                        palette.building,
                                        ['==', ['get', 'natural'], 'water'],
                                        palette.water,
                                        palette.land,
                                    ],
                                    'fill-opacity': 0.85,
                                },
                            },
                            {
                                id: 'water',
                                type: 'line',
                                source: 'terrain',
                                filter: ['has', 'waterway'],
                                paint: { 'line-color': palette.waterLine, 'line-width': 2 },
                            },
                            {
                                id: 'roads-outline',
                                type: 'line',
                                source: 'terrain',
                                filter: ['has', 'highway'],
                                paint: { 'line-color': palette.roadEdge, 'line-width': 5 },
                            },
                            {
                                id: 'roads',
                                type: 'line',
                                source: 'terrain',
                                filter: ['has', 'highway'],
                                paint: { 'line-color': palette.road, 'line-width': 3 },
                            },
                        ],
                    },
                    attributionControl: { compact: false },
                });
                map.current = instance;
                instance.addControl(new maplibregl.NavigationControl(), 'top-right');
                instance.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
                instance.on('dragstart', onExplore);
                const reportViewport = () => {
                    const bounds = instance.getBounds();
                    onViewport([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
                };
                instance.on('moveend', reportViewport);
                reportViewport();
                instance.on('error', (event) => {
                    setMapError(de.map.error(event.error.message));
                });
                instance.on('load', () => {
                    try {
                        if (disposed) {
                            return;
                        }
                        labels.current = installLabels(instance, data, labelSettings.current);
                        instance.addSource('accuracy', {
                            type: 'geojson',
                            data: { type: 'FeatureCollection', features: [] },
                        });
                        instance.addLayer({
                            id: 'accuracy-fill',
                            type: 'fill',
                            source: 'accuracy',
                            paint: { 'fill-color': palette.gps, 'fill-opacity': 0.16 },
                        });
                        instance.addLayer({
                            id: 'accuracy-line',
                            type: 'line',
                            source: 'accuracy',
                            paint: { 'line-color': palette.gps, 'line-width': 2 },
                        });
                        setMapReady(true);
                        onReady(instance);
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
            labels.current?.destroy();
            labels.current = null;
            marker.current?.remove();
            marker.current = null;
            onReady(null);
            map.current?.remove();
            map.current = null;
        };
    }, [mapPackage, onExplore, onViewport, onReady]);

    useLayoutEffect(() => {
        const instance = map.current;
        if (!mapReady || !instance) {
            return;
        }
        const palette = palettes[theme];
        instance.setPaintProperty('background', 'background-color', palette.background);
        instance.setPaintProperty('areas', 'fill-color', [
            'case',
            ['has', 'building'],
            palette.building,
            ['==', ['get', 'natural'], 'water'],
            palette.water,
            palette.land,
        ]);
        instance.setPaintProperty('water', 'line-color', palette.waterLine);
        instance.setPaintProperty('roads-outline', 'line-color', palette.roadEdge);
        instance.setPaintProperty('roads', 'line-color', palette.road);
        instance.setPaintProperty('accuracy-fill', 'fill-color', stale ? '#707070' : palette.gps);
        instance.setPaintProperty('accuracy-line', 'line-color', stale ? '#707070' : palette.gps);
    }, [theme, mapReady, stale]);

    useEffect(() => {
        if (!mapReady || !map.current || !fix) {
            return;
        }
        const instance = map.current;
        if (!marker.current) {
            const dot = document.createElement('div');
            dot.className = 'gps-dot';
            marker.current = new maplibregl.Marker({ element: dot }).setLngLat([fix.longitude, fix.latitude]).addTo(instance);
        }
        marker.current.setLngLat([fix.longitude, fix.latitude]);
        marker.current.getElement().classList.toggle('stale', stale);
        marker.current.getElement().setAttribute('aria-label', stale ? de.location.last : de.location.own);
        (instance.getSource('accuracy') as GeoJSONSource).setData(accuracyRing(fix));
        if (follow && !stale && area && !outside(fix, area.bounds)) {
            instance.easeTo({ center: [fix.longitude, fix.latitude], duration: 300 });
        }
    }, [fix, stale, mapReady, area, follow]);

    return (
        <section className="map-wrap" aria-label={de.map.label}>
            <svg className="night-filter" aria-hidden="true" width="0" height="0">
                <defs>
                    <filter id="as-tac-red-map" colorInterpolationFilters="sRGB">
                        <feColorMatrix
                            type="matrix"
                            values="0.2126 0.7152 0.0722 0 0  0.04252 0.14304 0.01444 0 0  0.034016 0.114432 0.011552 0 0  0 0 0 1 0"
                        />
                    </filter>
                </defs>
            </svg>
            <div ref={container} className="map" aria-busy={!mapReady} />
            <div className="map-caption">
                {area?.name ?? de.map.loading}
                <span>{de.map.local}</span>
            </div>
            <div className="map-label-options" aria-label={de.map.labels}>
                <label>
                    <input
                        type="checkbox"
                        checked={labelOptions.roads}
                        onChange={(event) => setLabelOptions({ ...labelOptions, roads: event.target.checked })}
                    />
                    {de.map.roads}
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={labelOptions.places}
                        onChange={(event) => setLabelOptions({ ...labelOptions, places: event.target.checked })}
                    />
                    {de.map.places}
                </label>
            </div>
            {mapError && (
                <p className="map-error" role="alert">
                    {mapError}
                </p>
            )}
        </section>
    );
}
