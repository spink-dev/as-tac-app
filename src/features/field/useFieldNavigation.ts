import { useEffect, useRef, useState } from 'react';
import type { Map as LibreMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import type { Fix } from '../../core/location/position';
import type { Coordinate } from '../../core/projects/model';
import { distance } from '../editor/geometry';
import {
    appendTrack,
    averageReference,
    calibration,
    coordinateOf,
    correctedFix,
    trackGeoJSON,
    usableFix,
    type Reference,
} from './navigation';
import { useMotion } from './useMotion';
export function useFieldNavigation(
    map: LibreMap | null,
    fix: Fix | null,
    stale: boolean,
    now: number,
    scope: string,
    pauseFollow: () => void,
) {
    const motion = useMotion();
    const [segments, setSegments] = useState<Fix[][]>([]);
    const [recording, setRecording] = useState(false);
    const gap = useRef(true);
    const [references, setReferences] = useState<Reference[]>([]);
    const [applied, setApplied] = useState(false);
    const [picking, setPicking] = useState(false);
    const [target, setTarget] = useState<Coordinate | null>(null);
    const [samples, setSamples] = useState<Fix[]>([]);
    const sampleAfter = useRef(0);
    const latestFix = useRef(fix);
    latestFix.current = fix;
    const [message, setMessage] = useState('');
    const previousScope = useRef(scope);
    const fresh = !stale && usableFix(fix, now);
    const count = segments.reduce((sum, part) => sum + part.length, 0);
    const displayFix = correctedFix(fix, references, applied, now);
    const corrected = displayFix !== fix;
    const rawMarker = corrected ? fix : null;
    useEffect(() => {
        if (previousScope.current !== scope) {
            previousScope.current = scope;
            setRecording(false);
            gap.current = true;
            setReferences([]);
            setApplied(false);
            setPicking(false);
            setTarget(null);
            setSamples([]);
        }
    }, [scope]);
    useEffect(() => {
        const pause = () => {
            setRecording(false);
            gap.current = true;
            setSamples([]);
        };
        const suspend = () => {
            if (document.visibilityState === 'hidden') {
                pause();
            }
        };
        document.addEventListener('visibilitychange', suspend);
        window.addEventListener('pagehide', pause);
        return () => {
            document.removeEventListener('visibilitychange', suspend);
            window.removeEventListener('pagehide', pause);
        };
    }, []);
    useEffect(() => {
        if (!recording || !fresh || !fix) {
            gap.current = true;
            return;
        }
        if (count >= 5000) {
            setRecording(false);
            setMessage('5000 Messpunkte erreicht. Aufnahme exportieren oder verwerfen.');
            return;
        }
        const split = gap.current;
        gap.current = false;
        setSegments((previous) => appendTrack(previous, fix, split));
    }, [fix, recording, fresh]);
    useEffect(() => {
        if (!target || !fresh || !fix || (motion.magnitude !== null && motion.magnitude > 1)) {
            if (target) {
                sampleAfter.current = fix?.timestamp ?? sampleAfter.current;
                setSamples([]);
            }
            return;
        }
        if (fix.timestamp <= sampleAfter.current) {
            return;
        }
        setSamples((previous) => (previous.at(-1)?.timestamp === fix.timestamp ? previous : [...previous, fix].slice(-20)));
    }, [fix, target, fresh, motion.magnitude]);
    useEffect(() => {
        if (!map || !picking) {
            return;
        }
        const click = (event: MapMouseEvent) => {
            const point = event.lngLat.wrap();
            sampleAfter.current = latestFix.current?.timestamp ?? 0;
            setTarget([point.lng, point.lat]);
            setSamples([]);
            setPicking(false);
            setMessage('Am gewählten Standort stehen bleiben. GPS-Messungen werden gesammelt.');
        };
        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', click);
        return () => {
            map.off('click', click);
            if (map.getStyle()) {
                map.getCanvas().style.cursor = '';
            }
        };
    }, [map, picking]);
    useEffect(() => {
        if (!map) {
            return;
        }
        map.addSource('field-survey', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'field-track',
            type: 'line',
            source: 'field-survey',
            filter: ['==', '$type', 'LineString'],
            paint: { 'line-color': '#28a9c7', 'line-width': 4, 'line-dasharray': [2, 1] },
        });
        map.addLayer({
            id: 'field-reference',
            type: 'circle',
            source: 'field-survey',
            filter: ['==', '$type', 'Point'],
            paint: { 'circle-radius': 7, 'circle-color': '#28a9c7', 'circle-stroke-color': '#14232b', 'circle-stroke-width': 2 },
        });
        return () => {
            if (map.getStyle()) {
                for (const id of ['field-reference', 'field-track']) {
                    if (map.getLayer(id)) {
                        map.removeLayer(id);
                    }
                }
                if (map.getSource('field-survey')) {
                    map.removeSource('field-survey');
                }
            }
        };
    }, [map]);
    useEffect(() => {
        if (!map?.getSource('field-survey')) {
            return;
        }
        const features: GeoJSON.Feature[] = trackGeoJSON(segments).features;
        const points = [
            ...references.map((point) => point.target),
            ...(target ? [target] : []),
            ...(rawMarker ? [coordinateOf(rawMarker)] : []),
        ];
        for (const point of points) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } });
        }
        (map.getSource('field-survey') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }, [map, segments, references, target, rawMarker]);
    function acceptReference() {
        if (!target || !fresh) {
            return;
        }
        try {
            if (references.some((point) => distance(point.target, target) < 20)) {
                throw new Error('Für den nächsten Kontrollpunkt mindestens 20 m weitergehen.');
            }
            const next = [...references, averageReference(target, samples)];
            if (next.length > 3 || !calibration(next)?.valid) {
                throw new Error('Die Punkte widersprechen sich. Punktwahl und GPS-Empfang prüfen; bisheriger Abgleich bleibt erhalten.');
            }
            setReferences(next);
            setApplied(false);
            setTarget(null);
            setSamples([]);
            setMessage('Kontrollpunkt übernommen. Weiteren Punkt prüfen oder den lokalen Versatz aktivieren.');
        } catch (error) {
            setMessage((error as Error).message);
        }
    }
    return {
        motion,
        fix,
        displayFix,
        corrected,
        fresh,
        count,
        recording,
        segments,
        references,
        fit: calibration(references),
        picking,
        target,
        samples,
        message,
        pending: count > 0 || recording || picking || !!target,
        start: () => {
            if (fresh && !picking && !target && count < 5000) {
                gap.current = true;
                setRecording(true);
                setMessage('Pfadaufnahme läuft nur im Vordergrund. Rohes GPS bleibt zunächst im Arbeitsspeicher.');
            }
        },
        pause: () => {
            setRecording(false);
            gap.current = true;
        },
        discard: (message = 'Pfad verworfen.') => {
            setRecording(false);
            setSegments([]);
            gap.current = true;
            setMessage(message);
        },
        pick: () => {
            setPicking(true);
            setTarget(null);
            setSamples([]);
            setApplied(false);
            pauseFollow();
            setMessage('Deinen bekannten Standort auf der Karte antippen. Danach stehen bleiben und GPS-Messungen abwarten.');
        },
        cancelPoint: () => {
            setPicking(false);
            setTarget(null);
            setSamples([]);
        },
        acceptReference,
        apply: () => {
            setApplied(true);
            setMessage('Lokaler Versatz aktiv: höchstens 10 Minuten und 500 m. Keine Änderung an Kartendaten.');
        },
        reset: () => {
            setReferences([]);
            setApplied(false);
            setTarget(null);
            setSamples([]);
            setPicking(false);
        },
    };
}
export type FieldNavigation = ReturnType<typeof useFieldNavigation>;
