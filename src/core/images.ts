import type { Draft } from 'immer';
import { mutate, useProject } from './store/project';
import { toast, useUi } from './store/ui';
import { uid } from './model/factory';
import type { ControlPoint, Element, ImageOverlay, LngLat, Project } from './model/schema';
import { prepareImage, putAsset } from './storage/assets';
import { cornersFromGeoref, fitControlPoints, placeImage, remapThroughImage, type Corners } from './geo/affine';
import { boundsSizeM, localProjector } from './geo/geo';
import { knownImage } from './templates/knownImages';
import { translateElement } from './model/geometry';
import { canEdit } from './actions';
import { t } from '../i18n';

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface ViewHint {
    center: LngLat;
    bounds: [number, number, number, number];
}

/** Add an image map. Known event maps are aligned by fingerprint; others are placed in view. */
export async function addImageMap(file: File, view: ViewHint): Promise<string | null> {
    if (!canEdit()) {
        return null;
    }
    const prepared = await prepareImage(file);
    const mime = IMAGE_MIME.has(prepared.blob.type) ? prepared.blob.type : 'image/webp';
    const asset = await putAsset(prepared.blob, file.name, { width: prepared.width, height: prepared.height });
    const known = prepared.downscaled ? null : knownImage(prepared.originalHash, prepared.width, prepared.height);
    let corners: Corners;
    let fit: ImageOverlay['fit'];
    let controlPoints: ControlPoint[] | undefined;
    if (known) {
        const result = fitControlPoints(known.controlPoints);
        corners = cornersFromGeoref(result.georef, prepared.width, prepared.height);
        fit = { method: 'known', rmsM: Math.round(result.rmsM * 10) / 10, maxM: Math.round(result.maxM * 10) / 10 };
        controlPoints = known.controlPoints;
    } else {
        const { width } = boundsSizeM(view.bounds);
        corners = placeImage(view.center, prepared.width, prepared.height, (width * 0.7) / prepared.width);
        fit = { method: 'manual' };
    }
    const image: ImageOverlay = {
        id: uid('img'), name: (known?.name ?? file.name.replace(/\.[^.]+$/, '')).slice(0, 160) || 'Bildkarte', asset: asset.hash, mime: mime as ImageOverlay['mime'],
        width: prepared.width, height: prepared.height, corners, opacity: known ? 0.85 : 0.75, visible: true, controlPoints, fit, knownId: known?.id,
    };
    mutate(t('maps.addImage'), (draft) => {
        draft.images.push(image);
    });
    if (known) {
        toast(t('maps.known', { rms: String(fit?.rmsM ?? '') }), { tone: 'ok' });
    } else {
        toast(t('maps.unaligned'));
        useUi.getState().set({ imageEditId: image.id, tool: 'select', selection: [] });
    }
    return image.id;
}

function remapElement(element: Element, from: Corners, to: Corners, w: number, h: number): Element {
    const map = (p: LngLat) => remapThroughImage(p, from, to, w, h);
    switch (element.kind) {
        case 'marker':
        case 'text':
            return { ...element, pos: map(element.pos) };
        case 'route':
            return { ...element, points: element.points.map(map) };
        case 'bearing':
            return { ...element, start: map(element.start), end: map(element.end) };
        case 'zone': {
            if (element.shape.type === 'circle') {
                const center = map(element.shape.center);
                const scale = boundsSizeM([to[0][0], to[0][1], to[1][0], to[1][1]]).width / Math.max(1e-9, boundsSizeM([from[0][0], from[0][1], from[1][0], from[1][1]]).width);
                return { ...element, shape: { ...element.shape, center, radiusM: element.shape.radiusM * (Number.isFinite(scale) && scale > 0 ? scale : 1) }, labelPos: element.labelPos ? map(element.labelPos) : undefined };
            }
            return { ...element, shape: { ...element.shape, points: element.shape.points.map(map) }, labelPos: element.labelPos ? map(element.labelPos) : undefined };
        }
    }
}

/** Write a new placement; bound elements and strokes follow when requested. One undo step per key. */
export function setImagePlacement(id: string, corners: Corners, patch: Partial<ImageOverlay>, moveBound: boolean, key: string) {
    const project = useProject.getState().project;
    const image = project?.images.find((i) => i.id === id);
    if (!project || !image || !canEdit()) {
        return;
    }
    const from = image.corners;
    mutate(t('align.title'), (draft) => {
        const target = draft.images.find((i) => i.id === id);
        if (!target) {
            return;
        }
        Object.assign(target, patch, { corners });
        if (moveBound) {
            draft.elements.forEach((element, i) => {
                if (element.anchorImageId === id && !element.locked) {
                    draft.elements[i] = remapElement(element as Element, from, corners, image.width, image.height) as Draft<Element>;
                }
            });
        }
    }, { key });
}

export function fitFromControlPoints(image: ImageOverlay, points: ControlPoint[]): { corners: Corners; fit: NonNullable<ImageOverlay['fit']> } | null {
    if (points.length < 2) {
        return null;
    }
    try {
        const result = fitControlPoints(points, points.length >= 3 ? 'affine' : 'similarity');
        return {
            corners: cornersFromGeoref(result.georef, image.width, image.height),
            fit: { method: result.method, rmsM: Math.round(result.rmsM * 10) / 10, maxM: Math.round(result.maxM * 10) / 10 },
        };
    } catch {
        return null;
    }
}

/** Similarity transform of the four corners: translate, or scale+rotate about the centre. */
export function transformCorners(corners: Corners, op: { kind: 'move'; d: LngLat } | { kind: 'corner'; index: number; to: LngLat }): Corners {
    if (op.kind === 'move') {
        return corners.map((c) => [c[0] + op.d[0], c[1] + op.d[1]]) as Corners;
    }
    const center: LngLat = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2];
    const projector = localProjector(center);
    const from = projector.toXY(corners[op.index]);
    const to = projector.toXY(op.to);
    const scale = Math.hypot(to[0], to[1]) / Math.max(1e-6, Math.hypot(from[0], from[1]));
    const rotation = Math.atan2(to[1], to[0]) - Math.atan2(from[1], from[0]);
    const cos = Math.cos(rotation) * scale;
    const sin = Math.sin(rotation) * scale;
    return corners.map((corner) => {
        const [x, y] = projector.toXY(corner);
        return projector.toLngLat([x * cos - y * sin, x * sin + y * cos]);
    }) as Corners;
}

export function removeImage(id: string) {
    mutate(t('common.delete'), (draft) => {
        draft.images = draft.images.filter((image) => image.id !== id);
        for (const element of draft.elements) {
            if (element.anchorImageId === id) {
                delete element.anchorImageId;
            }
        }
    });
    if (useUi.getState().imageEditId === id) {
        useUi.getState().set({ imageEditId: null });
    }
}

export function boundCount(project: Project, imageId: string): number {
    return project.elements.filter((element) => element.anchorImageId === imageId).length;
}

export { translateElement };
