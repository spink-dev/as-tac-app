import type { LngLat } from '../model/schema';

export const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

export function distanceM(a: LngLat, b: LngLat): number {
    const dLat = (b[1] - a[1]) * RAD;
    const dLng = (b[0] - a[0]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b in degrees [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
    const φ1 = a[1] * RAD;
    const φ2 = b[1] * RAD;
    const Δλ = (b[0] - a[0]) * RAD;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) / RAD + 360) % 360;
}

export function destination(origin: LngLat, bearing: number, distance: number): LngLat {
    const δ = distance / EARTH_RADIUS_M;
    const θ = bearing * RAD;
    const φ1 = origin[1] * RAD;
    const λ1 = origin[0] * RAD;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return [((λ2 / RAD + 540) % 360) - 180, φ2 / RAD];
}

export function pathLengthM(points: LngLat[]): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += distanceM(points[i - 1], points[i]);
    }
    return total;
}

/** Local equirectangular projection around an origin; accurate to well under 0.5 % within ~20 km. */
export function localProjector(origin: LngLat) {
    const kx = Math.cos(origin[1] * RAD) * EARTH_RADIUS_M * RAD;
    const ky = EARTH_RADIUS_M * RAD;
    return {
        toXY(p: LngLat): [number, number] {
            return [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky];
        },
        toLngLat(xy: [number, number]): LngLat {
            return [origin[0] + xy[0] / kx, origin[1] + xy[1] / ky];
        },
    };
}

export function polygonAreaM2(points: LngLat[]): number {
    if (points.length < 3) {
        return 0;
    }
    const projector = localProjector(centroid(points));
    const xy = points.map((p) => projector.toXY(p));
    let sum = 0;
    for (let i = 0; i < xy.length; i++) {
        const [x1, y1] = xy[i];
        const [x2, y2] = xy[(i + 1) % xy.length];
        sum += x1 * y2 - x2 * y1;
    }
    return Math.abs(sum) / 2;
}

export function centroid(points: LngLat[]): LngLat {
    let x = 0;
    let y = 0;
    for (const p of points) {
        x += p[0];
        y += p[1];
    }
    return [x / points.length, y / points.length];
}

export function circlePolygon(center: LngLat, radiusM: number, steps = 72): LngLat[] {
    const ring: LngLat[] = [];
    for (let i = 0; i <= steps; i++) {
        ring.push(destination(center, (i / steps) * 360, radiusM));
    }
    return ring;
}

export type Bounds = [number, number, number, number];

export function boundsOf(points: LngLat[]): Bounds {
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const p of points) {
        w = Math.min(w, p[0]);
        s = Math.min(s, p[1]);
        e = Math.max(e, p[0]);
        n = Math.max(n, p[1]);
    }
    return [w, s, e, n];
}

export function boundsSizeM(bounds: Bounds): { width: number; height: number } {
    const midLat = (bounds[1] + bounds[3]) / 2;
    return {
        width: distanceM([bounds[0], midLat], [bounds[2], midLat]),
        height: distanceM([bounds[0], bounds[1]], [bounds[0], bounds[3]]),
    };
}

export function pointInPolygon(point: LngLat, ring: LngLat[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/** Shortest distance from p to segment ab in metres (local projection). */
export function distanceToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
    const projector = localProjector(p);
    const [ax, ay] = projector.toXY(a);
    const [bx, by] = projector.toXY(b);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / lengthSq));
    return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToPathM(p: LngLat, points: LngLat[]): number {
    let best = Infinity;
    for (let i = 1; i < points.length; i++) {
        best = Math.min(best, distanceToSegmentM(p, points[i - 1], points[i]));
    }
    return best;
}

export function midpoint(a: LngLat, b: LngLat): LngLat {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function translate(points: LngLat[], dLng: number, dLat: number): LngLat[] {
    return points.map((p) => [p[0] + dLng, p[1] + dLat] as LngLat);
}

export function formatDistance(meters: number): string {
    if (!Number.isFinite(meters)) {
        return '–';
    }
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
}

export function formatArea(m2: number): string {
    if (m2 < 10000) {
        return `${Math.round(m2)} m²`;
    }
    return `${(m2 / 10000).toFixed(m2 < 1000000 ? 2 : 0)} ha`;
}

export function formatBearing(deg: number): string {
    const normalized = ((Math.round(deg) % 360) + 360) % 360;
    return `${String(normalized).padStart(3, '0')}°`;
}

/** NATO mils (6400 per circle). */
export function formatMils(deg: number): string {
    return `${String(Math.round((((deg % 360) + 360) % 360) * (6400 / 360)) % 6400).padStart(4, '0')} mil`;
}

export function formatLngLat(p: LngLat): string {
    const latH = p[1] >= 0 ? 'N' : 'S';
    const lngH = p[0] >= 0 ? 'E' : 'W';
    return `${Math.abs(p[1]).toFixed(5)}° ${latH}  ${Math.abs(p[0]).toFixed(5)}° ${lngH}`;
}

export function compassPoint(deg: number): string {
    const points = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
