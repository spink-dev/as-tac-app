import { useCallback, useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import type { Coordinate, PlanElement, Project, Workspace } from '../../core/projects/model';
import { execute } from '../../core/projects/commands';
import { saveElement } from '../briefing/commands';
import type { Command } from '../../core/projects/commands';
import { center, displayGeometry, distance, makeElement, translate, vertices, withVertices } from './geometry';
import { de } from '../../i18n/de';
export type Tool = 'select' | PlanElement['type'];
export function useEditor(
    map: LibreMap | null,
    project: Project | null,
    change: (commands: Command[]) => void,
    pauseFollow: () => void,
    visibleIds: string[] | null = null,
) {
    const [editing, setEditing] = useState(false);
    const [visible, setVisible] = useState(true);
    const [tool, setTool] = useState<Tool>('select');
    const [points, setPoints] = useState<Coordinate[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [activeLayer, setActiveLayer] = useState('');
    const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
    const [viewOpacity, setViewOpacity] = useState<Record<string, number>>({});
    const [hasUnsavedForm, setFormDirty] = useState(false);
    const [formEpoch, setFormEpoch] = useState(0);
    const [overlaps, setOverlaps] = useState<string[]>([]);
    const layers = project?.workspace?.layers ?? [];
    const canEdit = (element: PlanElement) => !layers.find((layer) => layer.id === element.layerId)?.locked;
    const shown = (element: PlanElement) =>
        !hiddenLayers.includes(element.layerId ?? '') &&
        element.style.opacity > 0 &&
        (viewOpacity[element.layerId ?? ''] ?? layers.find((layer) => layer.id === element.layerId)?.opacity ?? 1) > 0;
    const selected = project?.elements.find((element) => element.id === selectedId && !element.deletedAt) ?? null;
    useEffect(() => {
        setFormDirty(false);
    }, [selected?.id, selected?.version]);
    const pointsRef = useRef(points);
    pointsRef.current = points;
    const cancel = useCallback(() => {
        setPoints([]);
        pointsRef.current = [];
        setTool('select');
        setError('');
        setFormDirty(false);
        setFormEpoch((epoch) => epoch + 1);
    }, []);
    useEffect(() => {
        cancel();
        setSelectedId(null);
        setEditing(false);
        setActiveLayer('');
        setHiddenLayers([]);
        setViewOpacity({});
        setOverlaps([]);
    }, [project?.id, cancel]);
    function commit(element: PlanElement) {
        if (!project) {
            return false;
        }
        if (!canEdit(element) || (selected?.id === element.id && !canEdit(selected))) {
            setError('Diese Ebene ist gesperrt. Entsperre sie zuerst unter Ebenen.');
            return false;
        }
        try {
            const commands = saveElement(project, element);
            execute(project, commands);
            change(commands);
            setFormDirty(false);
            setError('');
            return true;
        } catch {
            setError(de.editor.invalid);
            return false;
        }
    }
    function finish(draft = pointsRef.current) {
        if (!project || tool === 'select') {
            return;
        }
        const minimum = tool === 'polygon' ? 3 : ['line', 'freehand', 'circle'].includes(tool) ? 2 : 1;
        if (draft.length < minimum) {
            setError(de.editor.morePoints);
            return;
        }
        const element = makeElement(project.id, tool, draft, de.editor.tools[tool]);
        if (hiddenLayers.includes(activeLayer)) {
            setError('Die Zeichenebene ist ausgeblendet. Bitte zuerst einblenden.');
            return;
        }
        if (activeLayer) {
            if (!layers.some((layer) => layer.id === activeLayer)) {
                setError('Zeichenebene fehlt. Bitte eine andere Ebene wählen.');
                return;
            }
            element.layerId = activeLayer;
        }
        if (commit(element)) {
            setSelectedId(element.id);
            cancel();
        }
    }
    const live = useRef({ project, tool, editing, visible, finish, commit, hasUnsavedForm });
    live.current = { project, tool, editing, visible, finish, commit, hasUnsavedForm };
    useEffect(() => {
        if (!map) {
            return;
        }
        map.addSource('plan', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('drawing', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
            id: 'plan-fill',
            type: 'fill',
            source: 'plan',
            filter: ['==', '$type', 'Polygon'],
            layout: { 'fill-sort-key': ['get', 'order'] },
            paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': ['*', ['get', 'opacity'], 0.25] },
        });
        map.addLayer({
            id: 'plan-line',
            type: 'line',
            source: 'plan',
            filter: ['!=', '$type', 'Point'],
            layout: { 'line-sort-key': ['get', 'order'] },
            paint: {
                'line-color': ['case', ['get', 'selected'], '#d55216', ['get', 'colour']],
                'line-width': ['+', ['get', 'width'], ['case', ['get', 'selected'], 2, 0]],
                'line-opacity': ['get', 'opacity'],
            },
        });
        map.addLayer({
            id: 'plan-point',
            type: 'circle',
            source: 'plan',
            filter: ['==', '$type', 'Point'],
            layout: { 'circle-sort-key': ['get', 'order'] },
            paint: {
                'circle-opacity': ['get', 'opacity'],
                'circle-stroke-opacity': ['get', 'opacity'],
                'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    12,
                    ['case', ['get', 'reference'], 3, 8],
                    16,
                    ['case', ['get', 'reference'], 6, 8],
                ],
                'circle-color': ['get', 'colour'],
                'circle-stroke-width': ['case', ['get', 'reference'], 1.5, 3],
                'circle-stroke-color': ['case', ['get', 'selected'], '#d55216', '#ffffff'],
            },
        });
        map.addLayer({
            id: 'drawing-line',
            type: 'line',
            source: 'drawing',
            filter: ['!=', '$type', 'Point'],
            paint: { 'line-color': '#d55216', 'line-width': 3, 'line-dasharray': [2, 2] },
        });
        map.addLayer({
            id: 'drawing-point',
            type: 'circle',
            source: 'drawing',
            filter: ['==', '$type', 'Point'],
            paint: { 'circle-color': '#d55216', 'circle-radius': 5 },
        });
        const click = (event: maplibregl.MapMouseEvent) => {
            const state = live.current;
            if (!state.project || !state.visible || state.hasUnsavedForm || state.tool === 'freehand') {
                return;
            }
            if (!state.editing || state.tool === 'select') {
                const hits = map.queryRenderedFeatures(
                    [
                        [event.point.x - 8, event.point.y - 8],
                        [event.point.x + 8, event.point.y + 8],
                    ],
                    { layers: ['plan-point', 'plan-line', 'plan-fill'] },
                );
                const ids = [...new Set(hits.map((hit) => String(hit.properties.id)))];
                setOverlaps(ids.length > 1 ? ids : []);
                setSelectedId(ids[0] ?? null);
                return;
            }
            pauseFollow();
            const next: Coordinate[] = [...pointsRef.current, [event.lngLat.wrap().lng, event.lngLat.lat]];
            if (next.length > 5_000) {
                setError(de.editor.limit);
                return;
            }
            pointsRef.current = next;
            setPoints(next);
            if (['point', 'text'].includes(state.tool) || (state.tool === 'circle' && next.length === 2)) {
                state.finish(next);
            }
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                cancel();
            }
        };
        map.on('click', click);
        window.addEventListener('keydown', escape);
        return () => {
            window.removeEventListener('keydown', escape);
            // The map may already have been removed during a verified area switch.
            if (!map.getStyle()) {
                return;
            }
            map.off('click', click);
            for (const id of ['plan-point', 'plan-line', 'plan-fill', 'drawing-line', 'drawing-point']) {
                if (map.getLayer(id)) {
                    map.removeLayer(id);
                }
            }
            for (const id of ['plan', 'drawing']) {
                if (map.getSource(id)) {
                    map.removeSource(id);
                }
            }
        };
    }, [map, cancel, pauseFollow]);
    useEffect(() => {
        if (!map?.getSource('plan')) {
            return;
        }
        const elements = visible
            ? (project?.elements.filter(
                  (element) => !element.deletedAt && shown(element) && (!visibleIds || visibleIds.includes(element.id)),
              ) ?? [])
            : [];
        (map.getSource('plan') as GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: elements.map((element) => ({
                type: 'Feature',
                geometry: displayGeometry(element.geometry),
                properties: {
                    id: element.id,
                    reference: !!element.sourceId,
                    ...element.style,
                    opacity:
                        element.style.opacity *
                        (viewOpacity[element.layerId ?? ''] ?? layers.find((layer) => layer.id === element.layerId)?.opacity ?? 1),
                    order: layers.findIndex((layer) => layer.id === element.layerId) + 1,
                    selected: element.id === selectedId,
                },
            })),
        });
        const markers: maplibregl.Marker[] = [];
        const labels: { node: HTMLElement; position: Coordinate; selected: boolean }[] = [];
        for (const element of elements) {
            if (element.label) {
                const label = document.createElement('span');
                label.className = 'plan-label';
                label.style.opacity = String(
                    element.style.opacity *
                        (viewOpacity[element.layerId ?? ''] ?? layers.find((layer) => layer.id === element.layerId)?.opacity ?? 1),
                );
                const team = project?.teams.find((item) => item.id === element.teamId);
                if (team) {
                    label.style.borderColor = team.colour;
                }
                label.textContent = `${team ? `[${team.shortLabel}] ` : ''}${element.label}`;
                labels.push({ node: label, position: center(element.geometry), selected: element.id === selectedId });
                markers.push(
                    new maplibregl.Marker({ element: label, anchor: 'bottom', offset: [0, -12] })
                        .setLngLat(center(element.geometry))
                        .addTo(map),
                );
            }
        }
        const layoutLabels = () => {
            if (!project?.workspace?.siteId) {
                return;
            }
            const occupied: { x: number; y: number; w: number; h: number }[] = [];
            for (const label of [...labels].sort((a, b) => Number(b.selected) - Number(a.selected))) {
                const position = map.project(label.position);
                const rect = {
                    x: position.x - label.node.offsetWidth / 2,
                    y: position.y - label.node.offsetHeight - 12,
                    w: label.node.offsetWidth + 8,
                    h: label.node.offsetHeight + 6,
                };
                const overlaps = occupied.some(
                    (other) =>
                        rect.x < other.x + other.w && rect.x + rect.w > other.x && rect.y < other.y + other.h && rect.y + rect.h > other.y,
                );
                const show =
                    label.selected ||
                    (!overlaps &&
                        position.x >= 0 &&
                        position.y >= 0 &&
                        position.x < map.getCanvas().clientWidth &&
                        position.y < map.getCanvas().clientHeight);
                label.node.style.visibility = show ? 'visible' : 'hidden';
                if (show) {
                    occupied.push(rect);
                }
            }
        };
        layoutLabels();
        map.on('move', layoutLabels);
        if (editing && !hasUnsavedForm && selected && visible && shown(selected) && canEdit(selected)) {
            const addHandle = (position: Coordinate, name: string, update: (coordinate: Coordinate) => PlanElement) => {
                const handle = document.createElement('button');
                handle.type = 'button';
                handle.className = 'edit-handle';
                handle.setAttribute('aria-label', name);
                handle.title = name;
                handle.textContent = name === de.editor.move ? '✥' : '•';
                const marker = new maplibregl.Marker({ element: handle, draggable: true }).setLngLat(position).addTo(map);
                marker.on('dragstart', pauseFollow);
                marker.on('dragend', () => {
                    const point = marker.getLngLat().wrap();
                    const element = update([point.lng, point.lat]);
                    if (!live.current.commit(element)) {
                        marker.setLngLat(position);
                    }
                });
                markers.push(marker);
            };
            const original = selected;
            addHandle(center(original.geometry), de.editor.move, (position) => ({
                ...original,
                version: original.version + 1,
                geometry: translate(original.geometry, position),
            }));
            const coords = vertices(original.geometry);
            if (coords.length > 1 && coords.length <= 200) {
                coords.forEach((coordinate, index) =>
                    addHandle(coordinate, `${de.editor.vertex} ${index + 1}`, (position) => ({
                        ...original,
                        version: original.version + 1,
                        geometry: withVertices(
                            original.geometry,
                            coords.map((old, i) => (i === index ? position : old)),
                        ),
                    })),
                );
            }
        }
        return () => {
            map.off('move', layoutLabels);
            markers.forEach((marker) => marker.remove());
        };
    }, [map, project, visible, visibleIds, selectedId, editing, selected, pauseFollow, hiddenLayers, viewOpacity, hasUnsavedForm]);
    useEffect(() => {
        if (!map?.getSource('drawing')) {
            return;
        }
        const features: GeoJSON.Feature[] = points.map((coordinates) => ({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates },
        }));
        if (points.length > 1) {
            features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points } });
        }
        (map.getSource('drawing') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    }, [map, points]);
    useEffect(() => {
        if (!map) {
            return;
        }
        const canvas = map.getCanvas();
        const drawing = editing && tool !== 'select';
        canvas.style.cursor = drawing ? 'crosshair' : '';
        if (drawing) {
            map.doubleClickZoom.disable();
        }
        if (editing && tool === 'freehand') {
            canvas.style.touchAction = 'none';
            map.dragPan.disable();
            map.touchZoomRotate.disable();
        }
        let pointer: number | null = null;
        const position = (event: PointerEvent): Coordinate => {
            const rect = canvas.getBoundingClientRect();
            const point = map.unproject([event.clientX - rect.left, event.clientY - rect.top]).wrap();
            return [point.lng, point.lat];
        };
        const down = (event: PointerEvent) => {
            if (!editing || tool !== 'freehand' || !visible || !project || !event.isPrimary || event.button !== 0) {
                return;
            }
            pointer = event.pointerId;
            pauseFollow();
            canvas.setPointerCapture(pointer);
            pointsRef.current = [position(event)];
            setPoints(pointsRef.current);
        };
        const move = (event: PointerEvent) => {
            if (pointer !== event.pointerId) {
                return;
            }
            const coordinate = position(event);
            if (pointsRef.current.length < 5_000 && distance(pointsRef.current.at(-1)!, coordinate) >= 2) {
                pointsRef.current = [...pointsRef.current, coordinate];
                setPoints(pointsRef.current);
            }
        };
        const up = (event: PointerEvent) => {
            if (pointer === event.pointerId) {
                pointer = null;
                canvas.releasePointerCapture(event.pointerId);
                if (pointsRef.current.length >= 2) {
                    live.current.finish();
                } else {
                    cancel();
                }
            }
        };
        const abort = () => {
            if (pointer !== null) {
                pointer = null;
                cancel();
            }
        };
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
            canvas.style.cursor = '';
            canvas.style.touchAction = '';
            map.doubleClickZoom.enable();
            map.dragPan.enable();
            map.touchZoomRotate.enable();
        };
    }, [map, editing, tool, visible, project?.id, pauseFollow, cancel]);
    return {
        viewOpacity,
        setViewOpacity,
        hasUnsavedForm,
        setFormDirty,
        formEpoch,
        changeLayers: (workspace: Workspace) => change([{ kind: 'project', schemaVersion: 2, workspace }]),
        activeLayer,
        setActiveLayer,
        hiddenLayers,
        setHiddenLayers,
        overlaps,
        setSelectedId,
        canEdit,
        editing,
        setEditing,
        visible,
        setVisible,
        tool,
        points,
        selected,
        error,
        commit,
        finish,
        cancel,
        hasDraft: points.length > 0,
        choose: (next: Tool) => {
            cancel();
            setTool(next);
            setOverlaps([]);
            setSelectedId(null);
            setVisible(true);
            pauseFollow();
        },
        select: (element: PlanElement) => {
            cancel();
            setSelectedId(element.id);
            setVisible(true);
            pauseFollow();
            map?.easeTo({ center: center(element.geometry), duration: 200 });
        },
        remove: () => {
            if (selected && project && canEdit(selected)) {
                const commands: Command[] = project.phases
                    .filter((phase) => phase.visibleElementIds.includes(selected.id))
                    .map((phase) => ({
                        kind: 'phase',
                        id: phase.id,
                        value: { ...phase, visibleElementIds: phase.visibleElementIds.filter((id) => id !== selected.id) },
                    }));
                change([...commands, { kind: 'element', id: selected.id, value: null }]);
                setSelectedId(null);
            }
        },
    };
}
export type Editor = ReturnType<typeof useEditor>;
