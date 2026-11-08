import type { LngLat } from '../model/schema';

/** WGS84 UTM/MGRS conversion (Krüger series, sub-millimetre within a zone). */
const a = 6378137;
const f = 1 / 298.257223563;
const k0 = 0.9996;
const e2 = f * (2 - f);
const ep2 = e2 / (1 - e2);
const RAD = Math.PI / 180;

export interface Utm {
    zone: number;
    hemisphere: 'N' | 'S';
    easting: number;
    northing: number;
    band: string;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

export function utmZone(p: LngLat): number {
    const [lng, lat] = p;
    let zone = Math.floor((lng + 180) / 6) + 1;
    if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) {
        zone = 32;
    }
    if (lat >= 72 && lat < 84) {
        if (lng >= 0 && lng < 9) {
            zone = 31;
        } else if (lng >= 9 && lng < 21) {
            zone = 33;
        } else if (lng >= 21 && lng < 33) {
            zone = 35;
        } else if (lng >= 33 && lng < 42) {
            zone = 37;
        }
    }
    return Math.min(60, Math.max(1, zone));
}

function meridionalArc(phi: number): number {
    const e4 = e2 * e2;
    const e6 = e4 * e2;
    return a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
        - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
        + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
        - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

export function toUtm(p: LngLat, forceZone?: number): Utm {
    const [lng, lat] = p;
    const zone = forceZone ?? utmZone(p);
    const lng0 = (zone - 1) * 6 - 180 + 3;
    const phi = lat * RAD;
    const lam = (lng - lng0) * RAD;
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    const tan = Math.tan(phi);
    const N = a / Math.sqrt(1 - e2 * sin * sin);
    const T = tan * tan;
    const C = ep2 * cos * cos;
    const A = cos * lam;
    const M = meridionalArc(phi);
    const easting = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
    let northing = k0 * (M + N * tan * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
        + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
    if (lat < 0) {
        northing += 10000000;
    }
    const bandIndex = Math.min(BANDS.length - 1, Math.max(0, Math.floor((lat + 80) / 8)));
    return { zone, hemisphere: lat < 0 ? 'S' : 'N', easting, northing, band: BANDS[bandIndex] };
}

export function fromUtm(zone: number, hemisphere: 'N' | 'S', easting: number, northing: number): LngLat {
    const lng0 = (zone - 1) * 6 - 180 + 3;
    const x = easting - 500000;
    const y = hemisphere === 'S' ? northing - 10000000 : northing;
    const M = y / k0;
    const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
        + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
        + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
        + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const sin = Math.sin(phi1);
    const cos = Math.cos(phi1);
    const tan = Math.tan(phi1);
    const N1 = a / Math.sqrt(1 - e2 * sin * sin);
    const T1 = tan * tan;
    const C1 = ep2 * cos * cos;
    const R1 = (a * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5;
    const D = x / (N1 * k0);
    const lat = phi1 - ((N1 * tan) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
        + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
    const lng = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / cos;
    return [lng0 + lng / RAD, lat / RAD];
}

const COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

export function squareId(utm: Utm): string {
    const set = (utm.zone - 1) % 3;
    const column = COLUMN_SETS[set][Math.floor(utm.easting / 100000) - 1] ?? '?';
    const rowOffset = utm.zone % 2 === 0 ? 5 : 0;
    const row = ROWS[(Math.floor(utm.northing / 100000) + rowOffset) % 20];
    return `${column}${row}`;
}

/** MGRS string, e.g. "32T MN 12345 67890". Precision in digits per axis (1–5). */
export function toMgrs(p: LngLat, digits = 5): string {
    if (p[1] < -80 || p[1] > 84) {
        return '–';
    }
    const utm = toUtm(p);
    const divisor = 10 ** (5 - digits);
    const e = String(Math.floor((utm.easting % 100000) / divisor)).padStart(digits, '0');
    const n = String(Math.floor((utm.northing % 100000) / divisor)).padStart(digits, '0');
    return `${utm.zone}${utm.band} ${squareId(utm)} ${e} ${n}`;
}

export interface GridLine {
    coordinates: LngLat[];
    label: string;
    major: boolean;
}

/**
 * UTM grid lines covering the given bounds in the zone of the bounds centre.
 * Lines are densified so they curve correctly in Web Mercator.
 */
export function utmGrid(bounds: [number, number, number, number], spacing: number, maxLines = 160): GridLine[] {
    const center: LngLat = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    const zone = utmZone(center);
    const hemi = center[1] < 0 ? 'S' : 'N';
    const corners = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]] as LngLat[];
    const utm = corners.map((c) => toUtm(c, zone));
    const minE = Math.floor(Math.min(...utm.map((u) => u.easting)) / spacing) * spacing;
    const maxE = Math.ceil(Math.max(...utm.map((u) => u.easting)) / spacing) * spacing;
    const minN = Math.floor(Math.min(...utm.map((u) => u.northing)) / spacing) * spacing;
    const maxN = Math.ceil(Math.max(...utm.map((u) => u.northing)) / spacing) * spacing;
    if ((maxE - minE) / spacing + (maxN - minN) / spacing > maxLines) {
        return [];
    }
    const lines: GridLine[] = [];
    const steps = 12;
    const label = (value: number) => {
        const within = Math.round(value % 100000);
        return spacing >= 1000 ? String(Math.floor(within / 1000)).padStart(2, '0') : String(Math.floor(within / 100)).padStart(3, '0');
    };
    for (let e = minE; e <= maxE; e += spacing) {
        const coordinates: LngLat[] = [];
        for (let i = 0; i <= steps; i++) {
            coordinates.push(fromUtm(zone, hemi, e, minN + ((maxN - minN) * i) / steps));
        }
        lines.push({ coordinates, label: label(e), major: e % (spacing * 10) === 0 });
    }
    for (let n = minN; n <= maxN; n += spacing) {
        const coordinates: LngLat[] = [];
        for (let i = 0; i <= steps; i++) {
            coordinates.push(fromUtm(zone, hemi, minE + ((maxE - minE) * i) / steps, n));
        }
        lines.push({ coordinates, label: label(n), major: n % (spacing * 10) === 0 });
    }
    return lines;
}
