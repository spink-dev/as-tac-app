import type { Map as MlMap, MapMouseEvent, MapTouchEvent, PointLike } from 'maplibre-gl';
import { create } from 'zustand';
import { useUi, toast } from '../core/store/ui';
import { useProject } from '../core/store/project';
import { fitFromControlPoints, setImagePlacement, transformCorners, validCorners } from '../core/images';
import { georefFromCorners, lngLatToPixel, pixelToLngLat, type Corners } from '../core/geo/affine';
import type { LngLat } from '../core/model/schema';
import { setSourceData } from './planLayers';
import { previewImageCorners } from './images';
import { t } from '../i18n';
import { canEdit } from '../core/actions';

/** Session state of the alignment tool. `preview` holds corners while a handle is dragged. */
export const useAlign = create<{ pendingPx: [number, number] | null; moveBound: boolean; preview: { id: string; corners: Corners } | null }>(() => ({
    pendingPx: null,
    moveBound: true,
    preview: null,
}));

type F = GeoJSON.Feature;
const pt = (coordinates: LngLat, properties: Record<string, unknown>): F => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });
const ln = (coordinates: LngLat[]): F => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });

/** Screen distance before a press on a handle becomes a drag (touch jitter must not move the image). */
const DRAG_THRESHOLD_PX = 4;

export function editingImage() {
    const id = useUi.getState().imageEditId;
    return id ? useProject.getState().project?.images.find((image) => image.id === id) ?? null : null;
}

/**
 * Alignment owns map input only while it can actually edit: plan mode, edit rights, the
 * image still exists and Streamer Safe is off (which hides it without changing state).
 */
export function alignActive(): boolean {
    const ui = useUi.getState();
    return Boolean(ui.imageEditId) && ui.mode === 'plan' && ui.streamer === 'off' && canEdit() && editingImage() !== null;
}

/** Map position from an event, or `null` when it lies outside the valid world (copies, poles). */
function eventLngLat(event: MapMouseEvent | MapTouchEvent): LngLat | null {
    const wrapped = event.lngLat.wrap();
    return Math.abs(wrapped.lat) <= 85.06 ? [wrapped.lng, wrapped.lat] : null;
}

/** Draw outline, handles and control-point pairs. Callers only call it while alignment is active. */
export function renderAlign(map: MlMap) {
    const image = editingImage();
    if (!image || !alignActive()) {
        return;
    }
    const preview = useAlign.getState().preview;
    const c = preview?.id === image.id ? preview.corners : image.corners;
    const features: F[] = [ln([c[0], c[1], c[2], c[3], c[0]])];
    if (!image.locked) {
        c.forEach((corner, index) => features.push(pt(corner, { id: image.id, role: 'corner', index })));
        features.push(pt([(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2], { id: image.id, role: 'move', index: 0 }));
    }
    const georef = georefFromCorners(c, image.width, image.height);
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

let abortActiveDrag: () => boolean = () => false;

/**
 * Escape while aligning: abort a running handle drag, else drop a half-set pair, else leave
 * alignment. Returns false when alignment had nothing to cancel.
 */
export function cancelAlign(): boolean {
    if (abortActiveDrag()) {
        return true;
    }
    if (!useUi.getState().imageEditId) {
        return false;
    }
    if (useAlign.getState().pendingPx) {
        useAlign.setState({ pendingPx: null });
        return true;
    }
    useUi.getState().set({ imageEditId: null });
    return true;
}

interface Drag {
    imageId: string;
    role: 'corner' | 'move';
    index: number;
    start: LngLat;
    startPoint: { x: number; y: number };
    corners: Corners;
    preview: Corners | null;
    panWasEnabled: boolean;
}

export function installAlign(map: MlMap): () => void {
    let drag: Drag | null = null;
    let suppress = 0;
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    const handleAt = (point: { x: number; y: number }) => {
        if (!map.getLayer('edit-handles')) {
            return null;
        }
        const r = coarse ? 24 : 14;
        const box: [PointLike, PointLike] = [[point.x - r, point.y - r], [point.x + r, point.y + r]];
        const feature = map.queryRenderedFeatures(box, { layers: ['edit-handles'] }).find((f) => f.properties?.role === 'corner' || (f.properties?.role === 'move' && f.properties?.index === 0));
        return feature ? { role: feature.properties.role as 'corner' | 'move', index: Number(feature.properties.index) } : null;
    };

    const release = () => {
        if (!drag) {
            return;
        }
        if (drag.panWasEnabled) {
            map.dragPan.enable();
        }
        drag = null;
        useAlign.setState({ preview: null });
    };

    /** Put the image back where it was and forget the gesture (cancel, blur, second finger). */
    const abort = (): boolean => {
        if (!drag) {
            return false;
        }
        const image = useProject.getState().project?.images.find((i) => i.id === drag?.imageId);
        if (image) {
            previewImageCorners(map, image, null);
        }
        release();
        return true;
    };
    abortActiveDrag = abort;

    const onDown = (event: MapMouseEvent | MapTouchEvent) => {
        abort();
        const original = event.originalEvent;
        if (original instanceof MouseEvent && original.button !== 0) {
            return;
        }
        if ('points' in event && event.points.length > 1) {
            return;
        }
        const image = editingImage();
        if (!image || image.locked || !alignActive()) {
            return;
        }
        const handle = handleAt(event.point);
        const start = eventLngLat(event);
        if (!handle || !start) {
            return;
        }
        event.preventDefault();
        const panWasEnabled = map.dragPan.isEnabled();
        map.dragPan.disable();
        drag = { imageId: image.id, ...handle, start, startPoint: { x: event.point.x, y: event.point.y }, corners: image.corners, preview: null, panWasEnabled };
    };

    const onMove = (event: MapMouseEvent | MapTouchEvent) => {
        if (!drag) {
            return;
        }
        if ('points' in event && event.points.length > 1) {
            abort();
            return;
        }
        const image = editingImage();
        const p = eventLngLat(event);
        if (!image || image.id !== drag.imageId || !p) {
            return;
        }
        if (!drag.preview && Math.hypot(event.point.x - drag.startPoint.x, event.point.y - drag.startPoint.y) < DRAG_THRESHOLD_PX) {
            return;
        }
        const corners = drag.role === 'move'
            ? transformCorners(drag.corners, { kind: 'move', d: [p[0] - drag.start[0], p[1] - drag.start[1]] })
            : transformCorners(drag.corners, { kind: 'corner', index: drag.index, to: p });
        if (!validCorners(corners)) {
            return;
        }
        // Preview only; the project changes once, on release (one undo step, one sync).
        drag.preview = corners;
        previewImageCorners(map, image, corners);
        useAlign.setState({ preview: { id: image.id, corners } });
    };

    const onUp = () => {
        if (!drag) {
            return;
        }
        const { imageId, preview } = drag;
        release();
        if (!preview) {
            return;
        }
        suppress = performance.now();
        // Manual placement replaces any control-point fit.
        setImagePlacement(imageId, preview, { controlPoints: undefined, fit: { method: 'manual' } }, useAlign.getState().moveBound, `align-drag:${imageId}:${suppress}`);
    };

    const onClick = (event: MapMouseEvent) => {
        const image = editingImage();
        if (!image || performance.now() - suppress < 350 || image.locked || !alignActive()) {
            return;
        }
        const p = eventLngLat(event);
        if (!p) {
            toast(t('align.outOfRange'), { tone: 'warn' });
            return;
        }
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
        const key = `align-cp:${image.id}:${controlPoints.length}`;
        if (controlPoints.length < 2) {
            useAlign.setState({ pendingPx: null });
            setImagePlacement(image.id, image.corners, { controlPoints }, false, key);
            return;
        }
        const result = fitFromControlPoints(image, controlPoints);
        if (!result) {
            // Keep the half pair so the user can tap the map again or press Escape.
            toast(t('align.implausible'), { tone: 'warn' });
            return;
        }
        useAlign.setState({ pendingPx: null });
        setImagePlacement(image.id, result.corners, { controlPoints, fit: result.fit }, useAlign.getState().moveBound, key);
    };

    const onCancel = () => {
        abort();
    };
    const onVisibility = () => {
        if (document.hidden) {
            abort();
        }
    };

    map.on('mousedown', onDown);
    map.on('touchstart', onDown);
    map.on('mousemove', onMove);
    map.on('touchmove', onMove);
    map.on('mouseup', onUp);
    map.on('touchend', onUp);
    map.on('touchcancel', onCancel);
    map.on('click', onClick);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    document.addEventListener('visibilitychange', onVisibility);

    const renderIfActive = () => {
        if (alignActive()) {
            renderAlign(map);
        }
    };
    const unsub = [
        useUi.subscribe((state, prev) => {
            if (state.imageEditId !== prev.imageEditId) {
                abort();
                useAlign.setState({ pendingPx: null });
                // MapView re-renders the edit layer (selection handles or alignment) on this change.
            }
        }),
        useAlign.subscribe(renderIfActive),
        useProject.subscribe((state, prev) => {
            if (state.project === prev.project) {
                return;
            }
            const id = useUi.getState().imageEditId;
            if (id && !state.project?.images.some((image) => image.id === id)) {
                // Undo, redo or a live peer removed the image: leave alignment cleanly.
                abort();
                useUi.getState().set({ imageEditId: null });
                return;
            }
            renderIfActive();
        }),
    ];
    return () => {
        abort();
        abortActiveDrag = () => false;
        map.off('mousedown', onDown);
        map.off('touchstart', onDown);
        map.off('mousemove', onMove);
        map.off('touchmove', onMove);
        map.off('mouseup', onUp);
        map.off('touchend', onUp);
        map.off('touchcancel', onCancel);
        map.off('click', onClick);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
        document.removeEventListener('visibilitychange', onVisibility);
        unsub.forEach((fn) => fn());
    };
}
