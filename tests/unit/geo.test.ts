import { describe, expect, it } from 'vitest';
import { bearingDeg, circlePolygon, destination, distanceM, formatBearing, formatMils, polygonAreaM2 } from '../../src/core/geo/geo';
import { fromUtm, toMgrs, toUtm, utmGrid } from '../../src/core/geo/mgrs';
import { cornersFromGeoref, fitControlPoints, georefFromCorners, lngLatToPixel, pixelToLngLat, placeImage, remapThroughImage } from '../../src/core/geo/affine';
import type { ControlPoint, LngLat } from '../../src/core/model/schema';

describe('geodesy', () => {
    it('measures known distances and bearings', () => {
        const zurich: LngLat = [8.5417, 47.3769];
        const bern: LngLat = [7.4474, 46.948];
        expect(distanceM(zurich, bern) / 1000).toBeCloseTo(95.5, 0);
        expect(bearingDeg(zurich, bern)).toBeGreaterThan(235);
        expect(bearingDeg(zurich, bern)).toBeLessThan(242);
        const north = destination(zurich, 0, 1000);
        expect(distanceM(zurich, north)).toBeCloseTo(1000, 3);
        const b = bearingDeg(zurich, north);
        expect(Math.min(b, 360 - b)).toBeCloseTo(0, 5);
    });

    it('computes areas of a 100 m square', () => {
        const origin: LngLat = [11.82, 52.38];
        const east = destination(origin, 90, 100);
        const ne = destination(east, 0, 100);
        const north = destination(origin, 0, 100);
        expect(polygonAreaM2([origin, east, ne, north])).toBeCloseTo(10000, -1);
        expect(polygonAreaM2(circlePolygon(origin, 100, 180))).toBeCloseTo(Math.PI * 10000, -2);
    });

    it('formats bearings and mils', () => {
        expect(formatBearing(5.4)).toBe('005°');
        expect(formatBearing(360)).toBe('000°');
        expect(formatMils(90)).toBe('1600 mil');
    });
});

describe('UTM / MGRS', () => {
    it('round-trips UTM within millimetres', () => {
        for (const p of [[8.5417, 47.3769], [11.82, 52.38], [-73.98, 40.75], [151.2, -33.86]] as LngLat[]) {
            const utm = toUtm(p);
            const back = fromUtm(utm.zone, utm.hemisphere, utm.easting, utm.northing);
            expect(distanceM(p, back)).toBeLessThan(0.01);
        }
    });

    it('produces reference MGRS strings', () => {
        // Zürich Hauptbahnhof: 32T MT 65290 47295.
        expect(toMgrs([8.5402, 47.3782], 5)).toBe('32T MT 65290 47295');
        // Mahlwinkel lies in zone 32U, square PD.
        expect(toMgrs([11.823, 52.381], 1)).toMatch(/^32U PD \d \d$/);
    });

    it('builds a bounded 1 km grid', () => {
        const lines = utmGrid([8.5, 47.35, 8.56, 47.4], 1000);
        expect(lines.length).toBeGreaterThan(8);
        expect(lines.length).toBeLessThan(30);
        expect(utmGrid([0, 40, 20, 60], 100)).toEqual([]);
    });
});

describe('image georeferencing', () => {
    const truth = placeImage([11.823, 52.381], 1280, 905, 1.6, -0.4);
    const truthRef = georefFromCorners(truth, 1280, 905);
    const sample = (px: [number, number]): ControlPoint => ({ px, lngLat: pixelToLngLat(truthRef, px) });

    it('recovers a placement from two points (similarity)', () => {
        const fit = fitControlPoints([sample([100, 100]), sample([1100, 800])], 'similarity');
        expect(fit.method).toBe('similarity');
        expect(fit.metersPerPixel).toBeCloseTo(1.6, 3);
        const corners = cornersFromGeoref(fit.georef, 1280, 905);
        corners.forEach((corner, i) => expect(distanceM(corner, truth[i])).toBeLessThan(0.05));
    });

    it('fits affine with residuals from 3+ points', () => {
        const fit = fitControlPoints([sample([100, 100]), sample([1100, 120]), sample([600, 800]), sample([200, 700])]);
        expect(fit.method).toBe('affine');
        expect(fit.rmsM).toBeLessThan(0.01);
        const px = lngLatToPixel(fit.georef, pixelToLngLat(truthRef, [640, 452]));
        expect(px[0]).toBeCloseTo(640, 2);
        expect(px[1]).toBeCloseTo(452, 2);
    });

    it('moves bound points with the image', () => {
        const moved = placeImage([11.83, 52.382], 1280, 905, 1.6, 10);
        const p = pixelToLngLat(truthRef, [300, 200]);
        const remapped = remapThroughImage(p, truth, moved, 1280, 905);
        const expected = pixelToLngLat(georefFromCorners(moved, 1280, 905), [300, 200]);
        expect(distanceM(remapped, expected)).toBeLessThan(0.01);
    });
});
