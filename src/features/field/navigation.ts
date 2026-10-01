import type { Fix } from '../../core/location/position';
import { validFix, STALE_MS } from '../../core/location/position';
import type { Coordinate } from '../../core/projects/model';
import { distance } from '../editor/geometry';
export type Reference = { target: Coordinate; measured: Coordinate; accuracy: number; timestamp: number };
export const coordinateOf = (fix: Fix): Coordinate => [fix.longitude, fix.latitude];
export function usableFix(fix: Fix | null, now = Date.now()): fix is Fix {
    return !!fix && validFix(fix) && now - fix.timestamp <= STALE_MS && fix.timestamp <= now + 5000 && fix.accuracy <= 25;
}
export function averageReference(target: Coordinate, fixes: Fix[]): Reference {
    if (fixes.length < 5 || fixes.at(-1)!.timestamp - fixes[0].timestamp < 4000 || fixes.some((fix) => !usableFix(fix))) {
        throw new Error('Mindestens fünf frische GPS-Messungen über vier Sekunden abwarten.');
    }
    const mean: Coordinate = [0, 0];
    let total = 0;
    for (const fix of fixes) {
        const weight = 1 / Math.max(3, fix.accuracy) ** 2;
        mean[0] += fix.longitude * weight;
        mean[1] += fix.latitude * weight;
        total += weight;
    }
    mean[0] /= total;
    mean[1] /= total;
    const spread = Math.max(...fixes.map((fix) => distance(mean, coordinateOf(fix))));
    if (spread > 15 || distance(mean, target) > 100) {
        throw new Error('Messungen streuen zu stark oder der gewählte Punkt liegt über 100 m entfernt. Erneut prüfen.');
    }
    return { target, measured: mean, accuracy: Math.max(spread, ...fixes.map((fix) => fix.accuracy)), timestamp: fixes.at(-1)!.timestamp };
}
export function calibration(references: Reference[]) {
    if (!references.length) {
        return null;
    }
    const offset: Coordinate = [0, 0];
    let weight = 0;
    for (const point of references) {
        const w = 1 / Math.max(3, point.accuracy) ** 2;
        offset[0] += (point.target[0] - point.measured[0]) * w;
        offset[1] += (point.target[1] - point.measured[1]) * w;
        weight += w;
    }
    offset[0] /= weight;
    offset[1] /= weight;
    const residual = Math.sqrt(
        references.reduce((sum, p) => sum + distance(p.target, [p.measured[0] + offset[0], p.measured[1] + offset[1]]) ** 2, 0) /
            references.length,
    );
    return { offset, residual, accuracy: Math.max(residual, ...references.map((p) => p.accuracy)), valid: residual <= 15 };
}
export function correctedFix(fix: Fix | null, references: Reference[], enabled: boolean, now: number): Fix | null {
    const fit = calibration(references);
    if (
        !fix ||
        !enabled ||
        !fit?.valid ||
        now - references.at(-1)!.timestamp > 600000 ||
        distance(coordinateOf(fix), references[0].measured) > 500
    ) {
        return fix;
    }
    const result = {
        ...fix,
        longitude: fix.longitude + fit.offset[0],
        latitude: fix.latitude + fit.offset[1],
        accuracy: Math.max(fix.accuracy, fit.accuracy),
    };
    return validFix(result) ? result : fix;
}
export function appendTrack(segments: Fix[][], fix: Fix, gap: boolean): Fix[][] {
    if (!usableFix(fix) || segments.reduce((sum, part) => sum + part.length, 0) >= 5000) {
        return segments;
    }
    const last = segments.at(-1)?.at(-1);
    if (last && fix.timestamp <= last.timestamp) {
        return segments;
    }
    if (!last || gap || fix.timestamp - last.timestamp > 15000) {
        return [...segments, [fix]];
    }
    const meters = distance(coordinateOf(last), coordinateOf(fix));
    if (meters < Math.max(3, Math.min(10, (last.accuracy + fix.accuracy) / 2)) || fix.timestamp - last.timestamp < 1000) {
        return segments;
    }
    // Reject jumps without drawing an invented shortcut on the next accepted fix.
    if (meters > (12 * (fix.timestamp - last.timestamp)) / 1000 + last.accuracy + fix.accuracy) {
        return [...segments, [fix]];
    }
    return [...segments.slice(0, -1), [...segments.at(-1)!, fix]];
}
export function trackGeoJSON(segments: Fix[][]): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: segments
            .filter((part) => part.length >= 2)
            .map((part, index) => ({
                type: 'Feature',
                properties: {
                    name: `Aufgenommener Pfad ${index + 1}`,
                    source: 'GPS, vom Nutzer aufgenommen',
                    accuracyMeters: Math.max(...part.map((fix) => fix.accuracy)),
                },
                geometry: { type: 'LineString', coordinates: part.map(coordinateOf) },
            })),
    };
}
