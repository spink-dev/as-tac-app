import type { Coordinate, Geometry, PlanElement } from '../../core/projects/model';
const R = 6371008.8;
const radians = Math.PI / 180;
export function distance(a: Coordinate, b: Coordinate): number {
    const lat = (b[1] - a[1]) * radians;
    const lon = (b[0] - a[0]) * radians;
    const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(lon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function vertices(geometry: Geometry): Coordinate[] {
    if (geometry.type === 'Circle') {
        return [geometry.center];
    }
    if (geometry.type === 'Point') {
        return [geometry.coordinates];
    }
    if (geometry.type === 'Polygon') {
        return geometry.coordinates[0].slice(0, -1);
    }
    return geometry.coordinates;
}
export function withVertices(geometry: Geometry, points: Coordinate[]): Geometry {
    if (geometry.type === 'Circle') {
        return { ...geometry, center: points[0] };
    }
    if (geometry.type === 'Point') {
        return { ...geometry, coordinates: points[0] };
    }
    if (geometry.type === 'Polygon') {
        return { ...geometry, coordinates: [[...points, points[0]], ...geometry.coordinates.slice(1)] };
    }
    return { ...geometry, coordinates: points };
}
export function center(geometry: Geometry): Coordinate {
    const points = vertices(geometry);
    return [(Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2,
        (Math.min(...points.map((p) => p[1])) + Math.max(...points.map((p) => p[1]))) / 2];
}
export function translate(geometry: Geometry, target: Coordinate): Geometry {
    const origin = center(geometry);
    const move = (point: Coordinate): Coordinate => [point[0] + target[0] - origin[0], point[1] + target[1] - origin[1]];
    if (geometry.type === 'Polygon') {
        return { ...geometry, coordinates: geometry.coordinates.map((ring) => ring.map(move)) };
    }
    return withVertices(geometry, vertices(geometry).map(move));
}
export function displayGeometry(geometry: Geometry): GeoJSON.Geometry {
    if (geometry.type !== 'Circle') {
        return geometry;
    }
    const lat = geometry.center[1] * radians;
    const lon = geometry.center[0] * radians;
    const angle = geometry.radiusMeters / R;
    const ring: Coordinate[] = [];
    for (let index = 0; index <= 64; index += 1) {
        const bearing = (index % 64) / 64 * 2 * Math.PI;
        const y = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(bearing));
        const x = lon + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(y));
        ring.push([((x / radians + 540) % 360) - 180, y / radians]);
    }
    return { type: 'Polygon', coordinates: [ring] };
}
export function measurements(geometry: Geometry): { length: number; area: number } {
    if (geometry.type === 'Circle') {
        return { length: 2 * Math.PI * geometry.radiusMeters, area: Math.PI * geometry.radiusMeters ** 2 };
    }
    const rings = geometry.type === 'Polygon' ? geometry.coordinates : [vertices(geometry)];
    const length = rings.reduce((sum, ring) => sum + ring.slice(1).reduce((part, point, index) => part + distance(ring[index], point), 0), 0);
    const areas = geometry.type === 'Polygon' ? rings.map((ring) => {
        let sum = 0;
        for (let index = 0; index < ring.length - 1; index += 1) {
            const a = ring[index];
            const b = ring[index + 1];
            const delta = ((b[0] - a[0] + 540) % 360) - 180;
            sum += delta * radians * (2 + Math.sin(a[1] * radians) + Math.sin(b[1] * radians));
        }
        return Math.abs(sum * R * R / 2);
    }) : [];
    return { length, area: Math.max(0, (areas[0] ?? 0) - areas.slice(1).reduce((sum, value) => sum + value, 0)) };
}
export function makeElement(projectId: string, type: PlanElement['type'], points: Coordinate[], label: string): PlanElement {
    let geometry: Geometry;
    if (type === 'point' || type === 'text') {
        geometry = { type: 'Point', coordinates: points[0] };
    } else if (type === 'circle') {
        geometry = { type: 'Circle', center: points[0], radiusMeters: distance(points[0], points[1]) };
    } else if (type === 'polygon') {
        geometry = { type: 'Polygon', coordinates: [[...points, points[0]]] };
    } else {
        geometry = { type: 'LineString', coordinates: points };
    }
    return { id: crypto.randomUUID(), projectId, type, geometry, label, notes: '', phaseIds: [],
        style: { colour: '#176b89', width: 3, opacity: 0.8 }, version: 1 };
}
