import type { Bounds } from '../geo/geo';

export interface PlaceResult {
    name: string;
    detail: string;
    center: [number, number];
    bounds?: Bounds;
}

/**
 * Nominatim place search. Usage policy: explicit searches only (no search-as-you-type),
 * at most one request per second, results cached by the browser.
 */
let last = 0;

export async function searchPlaces(query: string, locale: string, signal?: AbortSignal): Promise<PlaceResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
        return [];
    }
    // Reserve the slot before waiting so concurrent searches queue instead of firing together.
    const now = Date.now();
    const at = Math.max(now, last + 1100);
    last = at;
    if (at > now) {
        await new Promise((resolve) => setTimeout(resolve, at - now));
    }
    signal?.throwIfAborted();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', trimmed);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('accept-language', locale === 'en' ? 'en' : 'de');
    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const rows = await response.json() as { display_name: string; name?: string; lat: string; lon: string; boundingbox?: [string, string, string, string] }[];
    return rows.map((row) => {
        const parts = row.display_name.split(',').map((part) => part.trim());
        const bb = row.boundingbox?.map(Number);
        return {
            name: row.name || parts[0],
            detail: parts.slice(1, 4).join(', '),
            center: [Number(row.lon), Number(row.lat)] as [number, number],
            bounds: bb && bb.every(Number.isFinite) ? [bb[2], bb[0], bb[3], bb[1]] as Bounds : undefined,
        };
    });
}
