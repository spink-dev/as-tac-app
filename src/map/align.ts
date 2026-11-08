import type { Map as MlMap, MapMouseEvent, MapTouchEvent, PointLike } from 'maplibre-gl';
import { create } from 'zustand';
import { useUi, toast } from '../core/store/ui';
import { useProject } from '../core/store/project';
import { fitFromControlPoints, setImagePlacement, transformCorners } from '../core/images';
import { georefFromCorners, lngLatToPixel, pixelToLngLat, type Corners } from '../core/geo/affine';
import type { LngLat } from '../core/model/schema';
import { EMPTY_FC } from './basemap';
import { setSourceData } from './planLayers';
import { t } from '../i18n';
import { canEdit } from '../core/actions';

/** Session state of the alignment tool. */
export const useAlign = create<{ pendingPx: [number, number] | null; moveBound: boolean }>(() => ({ pendingPx: null, moveBound: true }));

type F = GeoJSON.Feature;
const pt = (coordinates: LngLat, properties: Record<string, unknown>): F => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
const ln = (coordinates: LngLat[]): F => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });

function editingImage() {
    const id = useUi.getState().imageEditId;
    return id ? useProject.getState().project?.images.find((image) => image.id === id) ?? null : null;
}

export function renderAlign(map: MlMap) {
    const image = editingImage();
    if (!image) {
        setSourceData(map, 'edit', EMPTY_FC);
        return;
    }
    const features: F[] = [];
    const c = image.corners;
    features.push(ln([c[0], c[1], c[2], c[3], c[0]]));
    if (!image.locked) {
        c.forEach((corner, index) => features.push(pt(corner, { id: image.id, role: 'corner', index })));
        features.push(pt([(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2], { id: image.id, role: 'move', index: 0 }));
    }
    const georef = georefFromCorners(image.corners, image.width, image.height);
    for (const cp of image.controlPoints ?? []) {
        const onImage = pixelToLngLat(georef, cp.px);
        features.push(ln([onImage, cp.lngLat]));
        features.push(pt(cp.lngLat, { id: image.id, role: 'vertex', index: -1 }));
        features.push(pt(onImage, { id: image.id, role: 'mid', index: -1 }));
    }
    const pending = useAlign.getState().pendingPx;
    if (pending) {
        features.push(pt(pixelToLngLat(georef, pending), { id: image.id, role: 'move', index: -1 }));
    }
    setSourceData(map, 'edit', { type: 'FeatureCollection', features });
}

export function installAlign(map: MlMap): () => void {
    let drag: { role: 'corner' | 'move'; index: number; start: LngLat; corners: Corners; moved: boolean } | null = null;
    let suppress = 0;

    const handleAt = (point: { x: number; y: number }) => {
        if (!map.getLayer('edit-handles')) {
            return null;
        }
        const box: [PointLike, PointLike] = [[point.x - 14, point.y - 14], [point.x + 14, point.y + 14]];
        const feature = map.queryRenderedFeatures(box, { layers: ['edit-handles'] }).find((f) => f.properties?.role === 'corner' || (f.properties?.role === 'move' && f.properties?.index === 0));
        return feature ? { role: feature.properties.role as 'corner' | 'move', index: Number(feature.properties.index) } : null;
    };

    const onDown = (event: MapMouseEvent | MapTouchEvent) => {
        const image = editingImage();
        if (!image || image.locked || !canEdit() || ('points' in event && event.points.length > 1)) {
            return;
        }
        const handle = handleAt(event.point);
        if (!handle) {
            return;
        }
        event.preventDefault();
        map.dragPan.disable();
        drag = { ...handle, start: [event.lngLat.lng, event.lngLat.lat], corners: image.corners, moved: false };
    };
    const onMove = (event: MapMouseEvent | MapTouchEvent) => {
        const image = editingImage();
        if (!drag || !image) {
            return;
        }
        drag.moved = true;
        const p: LngLat = [event.lngLat.lng, event.lngLat.lat];
        const corners = drag.role === 'move'
            ? transformCorners(drag.corners, { kind: 'move', d: [p[0] - drag.start[0], p[1] - drag.start[1]] })
            : transformCorners(drag.corners, { kind: 'corner', index: drag.index, to: p });
        // Manual placement replaces any control-point fit.
        setImagePlacement(image.id, corners, { controlPoints: undefined, fit: { method: 'manual' } }, useAlign.getState().moveBound, `align-drag:${image.id}:${drag.start.join()}`);
    };
    const onUp = () => {
        if (drag) {
            if (drag.moved) {
                suppress = performance.now();
            }
            drag = null;
            map.dragPan.enable();
        }
    };
    const onClick = (event: MapMouseEvent) => {
        const image = editingImage();
        if (!image || performance.now() - suppress < 350 || image.locked || !canEdit()) {
            return;
        }
        const p: LngLat = [event.lngLat.lng, event.lngLat.lat];
        const pending = useAlign.getState().pendingPx;
        if (!pending) {
            const px = lngLatToPixel(georefFromCorners(image.corners, image.width, image.height), p);
            if (px[0] < 0 || px[1] < 0 || px[0] > image.width || px[1] > image.height) {
                toast(t('align.pickImage'), { tone: 'warn' });
                return;
            }
            useAlign.setState({ pendingPx: [Math.round(px[0] * 10) / 10, Math.round(px[1] * 10) / 10] });
            return;
        }
        const controlPoints = [...(image.controlPoints ?? []), { px: pending, lngLat: p }].slice(-64);
        useAlign.setState({ pendingPx: null });
        const result = fitFromControlPoints(image, controlPoints);
        if (result) {
            setImagePlacement(image.id, result.corners, { controlPoints, fit: result.fit }, useAlign.getState().moveBound, `align-cp:${image.id}:${controlPoints.length}`);
        } else {
            setImagePlacement(image.id, image.corners, { controlPoints }, false, `align-cp:${image.id}:${controlPoints.length}`);
        }
    };

    map.on('mousedown', onDown);
    map.on('touchstart', onDown);
    map.on('mousemove', onMove);
    map.on('touchmove', onMove);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    map.on('click', onClick);
    window.addEventListener('pointerup', onUp);
    const unsub = [
        useUi.subscribe((state, prev) => {
            if (state.imageEditId !== prev.imageEditId) {
                useAlign.setState({ pendingPx: null });
                renderAlign(map);
            }
        }),
        useAlign.subscribe(() => renderAlign(map)),
        useProject.subscribe((state, prev) => {
            if (state.project !== prev.project && useUi.getState().imageEditId) {
                renderAlign(map);
            }
        }),
    ];
    return () => {
        map.off('mousedown', onDown);
        map.off('touchstart', onDown);
        map.off('mousemove', onMove);
        map.off('touchmove', onMove);
        map.off('mouseup', onUp);
        map.off('touchend', onUp);
        map.off('click', onClick);
        window.removeEventListener('pointerup', onUp);
        unsub.forEach((fn) => fn());
        map.dragPan.enable();
    };
}
