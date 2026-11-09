import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { areaKm2, cachedTiles, downloadArea, mergeTiles, OVERPASS_ENDPOINTS, secondsUntilNextDownload, tileBounds } from '../../src/core/areas/overpass';
import type { Bounds } from '../../src/core/geo/geo';

const AREA: Bounds = [11.80, 52.37, 11.83, 52.39];
/** Requests for one tile before a download gives up: every server, three rounds. */
const ATTEMPTS = OVERPASS_ENDPOINTS.length * 3;

/** A fake Overpass: one way per tile plus a way shared by all tiles, a node tagged in one tile only. */
function answer(query: string) {
    const bbox = /\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(query)!.slice(1).map(Number);
    const tileId = Math.round((bbox[0] + bbox[1]) * 1e4);
    return {
        osm3s: { timestamp_osm_base: `2026-11-0${tileId % 2 ? 1 : 2}T00:00:00Z` },
        elements: [
            { type: 'node', id: tileId, lat: bbox[0], lon: bbox[1] },
            { type: 'node', id: tileId + 1, lat: bbox[2], lon: bbox[3] },
            { type: 'way', id: tileId, nodes: [tileId, tileId + 1], tags: { highway: 'track' } },
            { type: 'node', id: 1, lat: 52.38, lon: 11.81, ...(tileId % 2 ? { tags: { name: 'Hof', place: 'farm' } } : {}) },
            { type: 'node', id: 2, lat: 52.381, lon: 11.811 },
            { type: 'way', id: 7, nodes: [1, 2], tags: { highway: 'path', name: 'Grenzweg' } },
        ],
    };
}

let calls: string[] = [];
let failing = new Set<number>();

beforeEach(() => {
    calls = [];
    failing = new Set();
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        const query = new URLSearchParams(init.body as URLSearchParams).get('data')!;
        calls.push(query);
        if (failing.has(calls.length)) {
            throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify(answer(query)));
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('tiled area downloads', () => {
    it('splits large areas into tiles of at most 4 km² that cover the area exactly', () => {
        const big: Bounds = [8.50, 47.35, 8.58, 47.40];
        const tiles = tileBounds(big);
        expect(tiles.length).toBeGreaterThanOrEqual(Math.ceil(areaKm2(big) / 4));
        expect(Math.max(...tiles.map(areaKm2))).toBeLessThanOrEqual(4.01);
        const sum = tiles.reduce((total, tile) => total + areaKm2(tile), 0);
        expect(Math.abs(sum - areaKm2(big))).toBeLessThan(0.05);
        expect(tileBounds([11.80, 52.37, 11.81, 52.375])).toHaveLength(1);
    });

    it('merges tiles without duplicates and keeps the tags of a node seen bare elsewhere', () => {
        const merged = mergeTiles([answer('x(52.37,11.80,52.38,11.81)'), answer('x(52.3801,11.81,52.39,11.82)')]);
        const ids = merged.elements.map((e) => `${(e as { type: string }).type}/${(e as { id: number }).id}`);
        expect(new Set(ids).size).toBe(ids.length);
        expect(merged.elements.filter((e) => (e as { id: number }).id === 7)).toHaveLength(1);
        expect((merged.elements.find((e) => (e as { type: string; id: number }).type === 'node' && (e as { id: number }).id === 1) as { tags?: object }).tags).toEqual({ name: 'Hof', place: 'farm' });
        expect(merged.osm3s?.timestamp_osm_base).toBe('2026-11-01T00:00:00Z');
    });

    it('retries a dropped tile and keeps finished tiles when a download fails, then continues', async () => {
        vi.useFakeTimers();
        const total = tileBounds(AREA).length;
        expect(total).toBeGreaterThan(1);
        // Every request for the last tile fails: every server, all rounds.
        failing = new Set(Array.from({ length: ATTEMPTS }, (_, i) => total + i));
        const first = downloadArea({ id: 'a', name: 'A', bounds: AREA, signal: new AbortController().signal, onProgress: () => undefined });
        const failed = first.catch((error: Error) => error);
        // (Not runAllTimers: that would also fire the 30-minute expiry of the kept tiles.)
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        const failure = await failed;
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe("Failed to fetch");
        expect(cachedTiles(AREA)).toBe(total - 1);
        // Next try (after the polite pause between downloads): only the missing tile is fetched.
        calls = [];
        failing = new Set([1]);
        vi.setSystemTime(Date.now() + 31000);
        const parts: number[] = [];
        const second = downloadArea({ id: 'a', name: 'A', bounds: AREA, signal: new AbortController().signal, onProgress: (_phase, _bytes, part) => part && parts.push(part.done) });
        await vi.runAllTimersAsync();
        const pkg = await second;
        expect(calls).toHaveLength(2);
        expect(parts[parts.length - 1]).toBe(total);
        const names = pkg.data.features.map((f) => f.properties?.name).filter(Boolean);
        expect(names.filter((n) => n === 'Grenzweg')).toHaveLength(1);
        expect(pkg.data.features.filter((f) => f.properties?.highway === 'track')).toHaveLength(total);
        expect(cachedTiles(AREA)).toBe(0);
    });

    it('resumes when the frame moved slightly, and forgets kept tiles after 30 minutes', async () => {
        vi.useFakeTimers();
        // Past the polite pause after the previous test's download.
        vi.setSystemTime(Date.now() + (secondsUntilNextDownload() + 1) * 1000);
        const total = tileBounds(AREA).length;
        failing = new Set(Array.from({ length: ATTEMPTS }, (_, i) => total + i));
        const failed = downloadArea({ id: 'b', name: 'B', bounds: AREA, signal: new AbortController().signal, onProgress: () => undefined }).catch((error: Error) => error);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(((await failed) as Error).message).toBe('Failed to fetch');
        // The map moved by about 7 m: still the same area.
        const nudged: Bounds = [AREA[0] + 0.0001, AREA[1], AREA[2] + 0.0001, AREA[3]];
        expect(cachedTiles(nudged)).toBe(total - 1);
        // A clearly different frame starts fresh.
        expect(cachedTiles([11.90, 52.37, 11.93, 52.39])).toBe(0);
        await vi.advanceTimersByTimeAsync(31 * 60_000);
        expect(cachedTiles(AREA)).toBe(0);
    });

    it('does not retry an answer that would fail the same way', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + (secondsUntilNextDownload() + 1) * 1000);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"version":0.6}')));
        const failed = downloadArea({ id: 'c', name: 'C', bounds: [11.80, 52.37, 11.81, 52.375], signal: new AbortController().signal, onProgress: () => undefined }).catch((error: Error) => error);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(((await failed) as Error).message).toBe('overpass-format');
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });
});
