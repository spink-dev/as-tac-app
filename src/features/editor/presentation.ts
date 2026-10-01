import type { Coordinate, PlanElement } from '../../core/projects/model';
import { center } from './geometry';
export const symbols = {
    auto: 'Automatisch',
    none: 'Kein Symbol',
    pin: 'Standort',
    flag: 'HQ / Flagge',
    shield: 'Safe Zone',
    warning: 'Gefahr',
    building: 'Gebäude',
    aid: 'Erste Hilfe',
} as const;
export const patterns = {
    auto: 'Automatisch',
    solid: 'Transparent',
    hatch: 'Diagonal ↗',
    cross: 'Kreuzschraffur',
    dots: 'Punkte',
    outline: 'Nur Umriss',
} as const;
export const labelModes = { auto: 'Nach Zoom', always: 'Immer', hidden: 'Ausblenden' } as const;
export function presentation(element: PlanElement) {
    const source = element.sourceId ?? '';
    const safe = source.includes(':zone:') && source.endsWith('-safe');
    const boundary = source.endsWith(':boundary') || source.includes(':site:');
    const hq = source.includes(':hq:');
    const poi = source.includes(':poi:');
    const hazard = /:zone:(verstrahlt|sperrgebiet)$/.test(source);
    const automatic = safe
        ? 'shield'
        : hq
          ? 'flag'
          : hazard
            ? 'warning'
            : poi
              ? 'building'
              : element.geometry.type === 'Point'
                ? 'pin'
                : 'none';
    return {
        symbol: element.style.symbol && element.style.symbol !== 'auto' ? element.style.symbol : automatic,
        pattern:
            element.style.pattern && element.style.pattern !== 'auto' ? element.style.pattern : safe ? 'hatch' : hazard ? 'cross' : 'solid',
        labelMode: element.style.labelMode && element.style.labelMode !== 'auto' ? element.style.labelMode : boundary ? 'hidden' : 'auto',
        priority: hq ? 90 : safe ? 80 : hazard ? 70 : poi ? 10 : 50,
        minZoom: poi ? 16 : safe ? 14 : 0,
    };
}
const paths: Record<string, string> = {
    pin: 'M12 22s7-8 7-13A7 7 0 0 0 5 9c0 5 7 13 7 13Z M9 9a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
    flag: 'M5 22V3h14l-3 5 3 5H5',
    shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z M7 12l3 3 7-7',
    warning: 'M12 2 1 22h22Z M12 8v6 M12 18v1',
    building: 'M4 22V4h16v18Z M8 8h2 M14 8h2 M8 12h2 M14 12h2 M10 22v-6h4v6',
    aid: 'M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z',
};
export function symbolNode(symbol: string) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[symbol] ?? paths.pin);
    svg.append(path);
    return svg;
}
/** Scan through the centre and choose an interior interval, including polygon holes. */
export function labelPosition(element: PlanElement): Coordinate {
    const fallback = center(element.geometry);
    if (element.geometry.type !== 'Polygon') {
        return fallback;
    }
    const y = fallback[1];
    const xs: number[] = [];
    for (const ring of element.geometry.coordinates) {
        for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1],
                b = ring[i];
            if (a[1] > y !== b[1] > y) {
                xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
            }
        }
    }
    xs.sort((a, b) => a - b);
    let width = -1,
        x = fallback[0];
    for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i + 1] - xs[i] > width) {
            width = xs[i + 1] - xs[i];
            x = (xs[i] + xs[i + 1]) / 2;
        }
    }
    return [x, y];
}
export function patternImage(kind: string, night: boolean) {
    const data = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const ink = kind === 'dots' ? (x - 4) ** 2 + (y - 4) ** 2 <= 3 : (x + y) % 8 < 2 || (kind === 'cross' && (x - y + 16) % 8 < 2);
            const offset = (y * 16 + x) * 4;
            data.set([night ? 195 : 35, night ? 195 : 43, night ? 195 : 48, ink ? 185 : 0], offset);
        }
    }
    return { width: 16, height: 16, data };
}
