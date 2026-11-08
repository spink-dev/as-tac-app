import type { Element, LngLat, Zone } from './schema';
import { destination, distanceM } from '../geo/geo';

function shift(p: LngLat, dLng: number, dLat: number): LngLat {
    return [p[0] + dLng, p[1] + dLat];
}

/** Move a whole element by a lng/lat delta (fine for the small distances of a drag). */
export function translateElement<T extends Element>(element: T, dLng: number, dLat: number): T {
    switch (element.kind) {
        case 'marker':
        case 'text':
            return { ...element, pos: shift(element.pos, dLng, dLat) };
        case 'route':
            return { ...element, points: element.points.map((p) => shift(p, dLng, dLat)) };
        case 'bearing':
            return { ...element, start: shift(element.start, dLng, dLat), end: shift(element.end, dLng, dLat) };
        case 'zone': {
            const zone = element as Zone;
            const shape = zone.shape.type === 'circle'
                ? { ...zone.shape, center: shift(zone.shape.center, dLng, dLat) }
                : { ...zone.shape, points: zone.shape.points.map((p) => shift(p, dLng, dLat)) };
            return { ...zone, shape, labelPos: zone.labelPos ? shift(zone.labelPos, dLng, dLat) : undefined } as T;
        }
    }
    return element;
}

export function vertices(element: Element): LngLat[] {
    switch (element.kind) {
        case 'route':
            return element.points;
        case 'bearing':
            return [element.start, element.end];
        case 'zone':
            return element.shape.type === 'polygon' ? element.shape.points : [];
        default:
            return [];
    }
}

export function moveVertex<T extends Element>(element: T, index: number, p: LngLat): T {
    switch (element.kind) {
        case 'route': {
            const points = [...element.points];
            points[index] = p;
            return { ...element, points };
        }
        case 'bearing':
            return index === 0 ? { ...element, start: p } : { ...element, end: p };
        case 'zone': {
            if (element.shape.type !== 'polygon') {
                return element;
            }
            const points = [...element.shape.points];
            points[index] = p;
            return { ...element, shape: { ...element.shape, points } };
        }
        default:
            return element;
    }
}

/** Insert a vertex after `index` (midpoint handles). */
export function insertVertex<T extends Element>(element: T, index: number, p: LngLat): T {
    if (element.kind === 'route') {
        const points = [...element.points];
        points.splice(index + 1, 0, p);
        return { ...element, points };
    }
    if (element.kind === 'zone' && element.shape.type === 'polygon') {
        const points = [...element.shape.points];
        points.splice(index + 1, 0, p);
        return { ...element, shape: { ...element.shape, points } };
    }
    return element;
}

export function removeVertex<T extends Element>(element: T, index: number): T {
    if (element.kind === 'route' && element.points.length > 2) {
        return { ...element, points: element.points.filter((_, i) => i !== index) };
    }
    if (element.kind === 'zone' && element.shape.type === 'polygon' && element.shape.points.length > 3) {
        return { ...element, shape: { ...element.shape, points: element.shape.points.filter((_, i) => i !== index) } };
    }
    return element;
}

export function setRadius<T extends Element>(element: T, edge: LngLat): T {
    if (element.kind === 'zone' && element.shape.type === 'circle') {
        return { ...element, shape: { ...element.shape, radiusM: Math.max(1, distanceM(element.shape.center, edge)) } };
    }
    return element;
}

export function radiusHandle(zone: Zone): LngLat | null {
    return zone.shape.type === 'circle' ? destination(zone.shape.center, 90, zone.shape.radiusM) : null;
}

/** Ramer–Douglas–Peucker on screen-ish coordinates for freehand strokes. */
export function simplify(points: [number, number][], tolerance: number): number[] {
    if (points.length <= 2) {
        return points.map((_, i) => i);
    }
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length) {
        const [start, end] = stack.pop() as [number, number];
        const [ax, ay] = points[start];
        const [bx, by] = points[end];
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.hypot(dx, dy) || 1;
        let max = 0;
        let index = -1;
        for (let i = start + 1; i < end; i++) {
            const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / length;
            if (d > max) {
                max = d;
                index = i;
            }
        }
        if (index > 0 && max > tolerance) {
            keep[index] = 1;
            stack.push([start, index], [index, end]);
        }
    }
    const result: number[] = [];
    keep.forEach((k, i) => {
        if (k) {
            result.push(i);
        }
    });
    return result;
}

export function isLocked(element: Element, lockedLayers: Set<string>, defaultLayer: string | undefined): boolean {
    return Boolean(element.locked) || lockedLayers.has(element.layerId ?? defaultLayer ?? '');
}
