import { useTheme } from '../appearance/theme';
import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import type { Coordinate, Phase, Project } from '../../core/projects/model';
import { execute, type Command } from '../../core/projects/commands';
import { distance, makeElement } from '../editor/geometry';
import { de } from '../../i18n/de';

export default function BriefingPanel({ project, map, change, onPhase, disabled, pauseFollow, readOnly = false, remotePhase }: {
    project: Project | null; map: LibreMap | null; change: (commands: Command[]) => void;
    onPhase: (phase: Phase | null) => void; disabled: boolean; pauseFollow: () => void; readOnly?: boolean; remotePhase?: { id: string | null };
}) {
    const theme = useTheme();
    const t = de.briefing;
    const [activeId, setActiveId] = useState<string | null>(null);
    const [drawing, setDrawing] = useState(false);
    const [strokes, setStrokes] = useState<Coordinate[][]>([]);
    const [error, setError] = useState(false);
    const phase = project?.phases.find((item) => item.id === activeId) ?? null;
    const phases = [...(project?.phases ?? [])].sort((a, b) => a.order - b.order);
    const index = phases.findIndex((item) => item.id === activeId);
    const latest = useRef({ phases, index });
    latest.current = { phases, index };
    useEffect(() => {
        setActiveId(null);
        setStrokes([]);
        setDrawing(false);
    }, [project?.id]);
    useEffect(() => {
        if (remotePhase) {
            setActiveId(remotePhase.id);
        }
    }, [remotePhase?.id, !!remotePhase]);
    useEffect(() => {
        onPhase(phase);
    }, [phase, onPhase]);
    useEffect(() => {
        setStrokes([]);
        setDrawing(false);
        setError(false);
        if (phase?.camera && map) {
            pauseFollow();
            map.jumpTo(phase.camera);
        }
    }, [activeId, map, pauseFollow]);
    useEffect(() => {
        if (!phase) {
            return;
        }
        const keyboard = (event: KeyboardEvent) => {
            if ((event.target as HTMLElement)?.closest('input,textarea,select') || drawing || remotePhase) {
                return;
            }
            const next = latest.current.index + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0);
            if (next !== latest.current.index && latest.current.phases[next]) {
                event.preventDefault();
                setActiveId(latest.current.phases[next].id);
            }
            if (event.key === 'Escape') {
                setActiveId(null);
            }
        };
        window.addEventListener('keydown', keyboard);
        return () => window.removeEventListener('keydown', keyboard);
    }, [phase?.id, drawing, !!remotePhase]);
    useEffect(() => {
        if (!map) {
            return;
        }
        map.addSource('briefing-notes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'briefing-notes-line', type: 'line', source: 'briefing-notes', paint: { 'line-color': '#d55216', 'line-width': 4 } });
        return () => {
            if (map.getStyle() && map.getLayer('briefing-notes-line')) {
                map.removeLayer('briefing-notes-line');
                map.removeSource('briefing-notes');
            }
        };
    }, [map]);
    useEffect(() => {
        if (map?.getLayer('briefing-notes-line')) {
            map.setPaintProperty('briefing-notes-line', 'line-color', theme === 'red' ? '#eeeeee' : '#d55216');
        }
    }, [map, theme]);
    useEffect(() => {
        const source = map?.getSource('briefing-notes') as GeoJSONSource | undefined;
        source?.setData({ type: 'FeatureCollection', features: phase ? strokes.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) : [] });
    }, [map, strokes, phase, drawing]);
    useEffect(() => {
        if (!map || !phase || !drawing) {
            return;
        }
        const canvas = map.getCanvas();
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'crosshair';
        map.dragPan.disable();
        map.touchZoomRotate.disable();
        let pointer: number | null = null;
        let points: Coordinate[] = [];
        const position = (event: PointerEvent): Coordinate => {
            const rect = canvas.getBoundingClientRect();
            const p = map.unproject([event.clientX - rect.left, event.clientY - rect.top]).wrap();
            return [p.lng, p.lat];
        };
        const down = (event: PointerEvent) => {
            if (!event.isPrimary || event.button !== 0) {
                return;
            }
            pointer = event.pointerId;
            canvas.setPointerCapture(pointer);
            points = [position(event)];
            pauseFollow();
        };
        const move = (event: PointerEvent) => {
            if (pointer === event.pointerId && points.length < 2_000) {
                const p = position(event);
                if (distance(points.at(-1)!, p) >= 2) {
                    points.push(p);
                    const source = map.getSource('briefing-notes') as GeoJSONSource;
                    source.setData({ type: 'FeatureCollection', features: [...strokes, points].map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) });
                }
            }
        };
        const up = (event: PointerEvent) => {
            if (pointer === event.pointerId) {
                pointer = null;
                if (points.length >= 2) {
                    setStrokes((old) => [...old, points].slice(-50));
                }
                setDrawing(false);
            }
        };
        const abort = () => setDrawing(false);
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', abort);
        window.addEventListener('blur', abort);
        return () => {
            canvas.removeEventListener('pointerdown', down);
            canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerup', up);
            canvas.removeEventListener('pointercancel', abort);
            window.removeEventListener('blur', abort);
            canvas.style.touchAction = '';
            canvas.style.cursor = '';
            map.dragPan.enable();
            map.touchZoomRotate.enable();
        };
    }, [map, phase?.id, drawing, pauseFollow, strokes]);
    if (!project) {
        return null;
    }
    return <section aria-label={t.title}><h2>{t.title}</h2>
        {!phase ? <button disabled={disabled || !map || !phases.length || !!remotePhase} onClick={() => setActiveId(phases[0].id)}>{t.start}</button> : <>
            <h3>{index + 1} / {phases.length} · {phase.title}</h3>
            <p className="notes">{phase.notes}</p>
            <p>{t.visibleCount(phase.visibleElementIds.length)}</p>
            <div className="actions">
                <button disabled={index <= 0 || drawing || !!remotePhase} onClick={() => setActiveId(phases[index - 1].id)}>{t.previous}</button>
                <button disabled={index >= phases.length - 1 || drawing || !!remotePhase} onClick={() => setActiveId(phases[index + 1].id)}>{t.next}</button>
                <button disabled={!!remotePhase} onClick={() => setActiveId(null)}>{t.stop}</button>
            </div>
            <p className="muted">{t.temporary}</p>
            <p role="status">{t.strokeCount(strokes.length)}</p>
            <div className="actions">
                <button data-draw-tool="briefing" aria-pressed={drawing} onClick={() => setDrawing(!drawing)}>{drawing ? t.cancelDrawing : t.draw}</button>
                <button disabled={!strokes.length || drawing} onClick={() => setStrokes([])}>{t.clear}</button>
                <button disabled={readOnly || !strokes.length || drawing} onClick={() => {
                    try {
                        const elements = strokes.map((points) => ({ ...makeElement(project.id, 'freehand', points, t.annotation), phaseIds: [phase.id] }));
                        const commands: Command[] = [...elements.map((element): Command => ({ kind: 'element', id: element.id, value: element })), { kind: 'phase', id: phase.id, value: { ...phase, visibleElementIds: [...phase.visibleElementIds, ...elements.map((element) => element.id)] } }];
                        execute(project, commands);
                        change(commands);
                        setStrokes([]);
                        setError(false);
                    } catch {
                        setError(true);
                    }
                }}>{t.adopt}</button>
            </div>
            {error && <p role="alert">{de.editor.invalid}</p>}
        </>}
    </section>;
}
