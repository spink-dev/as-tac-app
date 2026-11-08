import { afterEach, describe, expect, it, vi } from 'vitest';
import { pullAll, wire } from '../../src/core/live/session';
import type { LiveTransport, PullOptions, RemoteEntity } from '../../src/core/live/types';

function fakeTransport(rows: RemoteEntity[], failures: number[] = []): LiveTransport & { calls: PullOptions[] } {
    let call = 0;
    const calls: PullOptions[] = [];
    return {
        kind: 'loopback',
        planId: 'p',
        calls,
        async pull(since: number, options: PullOptions) {
            calls.push(options);
            call += 1;
            if (failures.includes(call)) {
                throw new TypeError('Failed to fetch');
            }
            return rows.filter((row) => row.seq > since).sort((a, b) => a.seq - b.seq).slice(0, options.limit);
        },
    } as unknown as LiveTransport & { calls: PullOptions[] };
}

const entity = (seq: number, id = `e${seq}`): RemoteEntity => ({ collection: 'elements', entityId: id, data: { id }, version: 1, seq, clientId: 'x' });

afterEach(() => {
    vi.useRealTimers();
});

describe('live wire format', () => {
    it('rounds fractions to 7 decimals and leaves everything else alone', () => {
        const input = { id: 'el_1', pos: [8.541234567890123, 47.37712345678901], width: 3, opacity: 0.85, label: 'A', n: null, flag: true };
        expect(wire(input)).toEqual({ id: 'el_1', pos: [8.5412346, 47.3771235], width: 3, opacity: 0.85, label: 'A', n: null, flag: true });
        expect(JSON.stringify(wire({ points: [[8.541234567890123, 47.37712345678901]] })).length).toBeLessThan(JSON.stringify({ points: [[8.541234567890123, 47.37712345678901]] }).length * 0.75);
        // Rounding twice changes nothing (local base and server copy compare equal).
        expect(wire(wire(input))).toEqual(wire(input));
    });

    it('downloads a plan page by page and keeps the newest version of each object', async () => {
        const rows = Array.from({ length: 450 }, (_, i) => entity(i + 1));
        rows.push({ ...entity(451, 'e1'), version: 2, data: { id: 'e1', label: 'neu' } });
        const transport = fakeTransport(rows);
        const progress: number[] = [];
        const all = await pullAll(transport, (n) => progress.push(n));
        expect(all).toHaveLength(450);
        expect(all.find((e) => e.entityId === 'e1')?.version).toBe(2);
        expect(transport.calls.length).toBeGreaterThan(1);
        expect(transport.calls[0].limit).toBeLessThanOrEqual(200);
        expect(progress[progress.length - 1]).toBe(450);
    });

    it('retries a dropped page with smaller pages instead of failing the download', async () => {
        vi.useFakeTimers();
        const rows = Array.from({ length: 300 }, (_, i) => entity(i + 1));
        const transport = fakeTransport(rows, [2, 3]);
        const done = pullAll(transport);
        await vi.runAllTimersAsync();
        const all = await done;
        expect(all).toHaveLength(300);
        const limits = transport.calls.map((c) => c.limit);
        expect(Math.min(...limits.slice(1))).toBeLessThan(limits[0]);
    });
});
