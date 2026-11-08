import type { ControlPoint, LngLat } from '../model/schema';
import { centroid, localProjector } from './geo';

/** x' = a*x + b*y + c ; y' = d*x + e*y + f   (image pixels → local metres) */
export interface Affine {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
}

export interface Georef {
    origin: LngLat;
    affine: Affine;
}

export interface FitResult {
    georef: Georef;
    method: 'similarity' | 'affine';
    rmsM: number;
    maxM: number;
    residualsM: number[];
    metersPerPixel: number;
    rotationDeg: number;
}

export function applyAffine(t: Affine, x: number, y: number): [number, number] {
    return [t.a * x + t.b * y + t.c, t.d * x + t.e * y + t.f];
}

export function invertAffine(t: Affine): Affine {
    const det = t.a * t.e - t.b * t.d;
    if (Math.abs(det) < 1e-12) {
        throw new Error('singular');
    }
    const a = t.e / det;
    const b = -t.b / det;
    const d = -t.d / det;
    const e = t.a / det;
    return { a, b, c: -(a * t.c + b * t.f), d, e, f: -(d * t.c + e * t.f) };
}

export function pixelToLngLat(g: Georef, px: [number, number]): LngLat {
    return localProjector(g.origin).toLngLat(applyAffine(g.affine, px[0], px[1]));
}

export function lngLatToPixel(g: Georef, p: LngLat): [number, number] {
    const xy = localProjector(g.origin).toXY(p);
    return applyAffine(invertAffine(g.affine), xy[0], xy[1]);
}

/** Solve a small dense linear system with partial pivoting. */
function solve(matrix: number[][], vector: number[]): number[] {
    const n = vector.length;
    const m = matrix.map((row, i) => [...row, vector[i]]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
                pivot = row;
            }
        }
        if (Math.abs(m[pivot][col]) < 1e-12) {
            throw new Error('degenerate');
        }
        [m[col], m[pivot]] = [m[pivot], m[col]];
        for (let row = 0; row < n; row++) {
            if (row !== col) {
                const factor = m[row][col] / m[col][col];
                for (let k = col; k <= n; k++) {
                    m[row][k] -= factor * m[col][k];
                }
            }
        }
    }
    return m.map((row, i) => row[n] / row[i]);
}

function leastSquares(rows: number[][], values: number[]): number[] {
    const n = rows[0].length;
    const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const atb = new Array<number>(n).fill(0);
    rows.forEach((row, r) => {
        for (let i = 0; i < n; i++) {
            atb[i] += row[i] * values[r];
            for (let j = 0; j < n; j++) {
                ata[i][j] += row[i] * row[j];
            }
        }
    });
    return solve(ata, atb);
}

/**
 * Fit image pixels to geography. Two points give a similarity (scale, rotation, shift);
 * three or more well-spread points allow an affine fit that also absorbs skewed scans.
 */
export function fitControlPoints(points: ControlPoint[], prefer: 'similarity' | 'affine' = 'affine'): FitResult {
    if (points.length < 2) {
        throw new Error('need-2-points');
    }
    const origin = centroid(points.map((p) => p.lngLat));
    const projector = localProjector(origin);
    const geo = points.map((p) => projector.toXY(p.lngLat));
    const method = prefer === 'affine' && points.length >= 3 ? 'affine' : 'similarity';
    let affine: Affine;
    if (method === 'affine') {
        const rows = points.map((p) => [p.px[0], p.px[1], 1]);
        const [a, b, c] = leastSquares(rows, geo.map((g) => g[0]));
        const [d, e, f] = leastSquares(rows, geo.map((g) => g[1]));
        affine = { a, b, c, d, e, f };
    } else {
        // Image y grows downwards, geography y grows north: similarity with reflection.
        // x' = s*cos*x + s*sin*y + tx ; y' = s*sin*x - s*cos*y + ty
        const rows: number[][] = [];
        const values: number[] = [];
        points.forEach((p, i) => {
            rows.push([p.px[0], p.px[1], 1, 0]);
            values.push(geo[i][0]);
            rows.push([-p.px[1], p.px[0], 0, 1]);
            values.push(geo[i][1]);
        });
        const [p, q, tx, ty] = leastSquares(rows, values);
        affine = { a: p, b: q, c: tx, d: q, e: -p, f: ty };
    }
    const residualsM = points.map((p, i) => {
        const [x, y] = applyAffine(affine, p.px[0], p.px[1]);
        return Math.hypot(x - geo[i][0], y - geo[i][1]);
    });
    const rmsM = Math.sqrt(residualsM.reduce((sum, r) => sum + r * r, 0) / residualsM.length);
    const metersPerPixel = (Math.hypot(affine.a, affine.d) + Math.hypot(affine.b, affine.e)) / 2;
    const rotationDeg = (Math.atan2(affine.d, affine.a) * 180) / Math.PI;
    return { georef: { origin, affine }, method, rmsM, maxM: Math.max(...residualsM), residualsM, metersPerPixel, rotationDeg };
}

export type Corners = [LngLat, LngLat, LngLat, LngLat];

export function cornersFromGeoref(g: Georef, width: number, height: number): Corners {
    return [
        pixelToLngLat(g, [0, 0]),
        pixelToLngLat(g, [width, 0]),
        pixelToLngLat(g, [width, height]),
        pixelToLngLat(g, [0, height]),
    ];
}

/** Recover the exact pixel→geo mapping of an already placed image from its corners. */
export function georefFromCorners(corners: Corners, width: number, height: number): Georef {
    const origin = corners[0];
    const projector = localProjector(origin);
    const tl = projector.toXY(corners[0]);
    const tr = projector.toXY(corners[1]);
    const bl = projector.toXY(corners[3]);
    return {
        origin,
        affine: {
            a: (tr[0] - tl[0]) / width,
            b: (bl[0] - tl[0]) / height,
            c: tl[0],
            d: (tr[1] - tl[1]) / width,
            e: (bl[1] - tl[1]) / height,
            f: tl[1],
        },
    };
}

/** Place an image north-up, centred on a point, at a given ground resolution. */
export function placeImage(center: LngLat, width: number, height: number, metersPerPixel: number, rotationDeg = 0): Corners {
    const projector = localProjector(center);
    const r = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const corner = (x: number, y: number): LngLat => {
        const dx = (x - width / 2) * metersPerPixel;
        const dy = -(y - height / 2) * metersPerPixel;
        return projector.toLngLat([dx * cos - dy * sin, dx * sin + dy * cos]);
    };
    return [corner(0, 0), corner(width, 0), corner(width, height), corner(0, height)];
}

/** Map a point that was placed relative to an image from its old placement to a new one. */
export function remapThroughImage(p: LngLat, from: Corners, to: Corners, width: number, height: number): LngLat {
    const px = lngLatToPixel(georefFromCorners(from, width, height), p);
    return pixelToLngLat(georefFromCorners(to, width, height), px);
}
