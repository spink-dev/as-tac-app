export interface Fix {
    longitude: number;
    latitude: number;
    accuracy: number;
    timestamp: number;
    speed?: number | null;
}

export const STALE_MS = 30_000;

export function validFix(fix: Fix): boolean {
    return [fix.longitude, fix.latitude, fix.accuracy, fix.timestamp].every(Number.isFinite)
        && (fix.speed == null || Number.isFinite(fix.speed) && fix.speed >= 0)
        && Math.abs(fix.longitude) <= 180 && Math.abs(fix.latitude) <= 90
        && fix.accuracy >= 0 && fix.timestamp > 0;
}

export function outside(fix: Fix, bounds: number[]): boolean {
    return fix.longitude < bounds[0] || fix.latitude < bounds[1]
        || fix.longitude > bounds[2] || fix.latitude > bounds[3];
}

export function accuracyRing(fix: Fix): GeoJSON.Feature<GeoJSON.Polygon> {
    const rad = Math.PI / 180;
    const lat = fix.latitude * rad;
    const lon = fix.longitude * rad;
    const distance = fix.accuracy / 6371008.8;
    const ring: number[][] = [];
    for (let i = 0; i <= 64; i++) {
        const bearing = i / 64 * 2 * Math.PI;
        const y = Math.asin(Math.sin(lat) * Math.cos(distance)
            + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
        const x = lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat),
            Math.cos(distance) - Math.sin(lat) * Math.sin(y));
        ring.push([((x / rad + 540) % 360) - 180, y / rad]);
    }
    ring[ring.length - 1] = [...ring[0]];
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}
