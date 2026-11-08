import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIECE, partialBytes, rangeDownload, tusUpload, TUS_PIECE } from '../../src/core/live/transfer';

afterEach(() => {
    vi.useRealTimers();
});

function file(size: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        bytes[i] = (i * 31 + 7) & 255;
    }
    return bytes;
}

/** A server that honours ranges and fails the requests whose numbers are listed. */
function rangeServer(bytes: Uint8Array, failing: Set<number>, ranges = true) {
    const requests: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
        const range = (init.headers as Record<string, string>).Range;
        requests.push(range);
        if (failing.has(requests.length)) {
            throw new TypeError('Failed to fetch');
        }
        if (!ranges) {
            return new Response(bytes.slice(), { status: 200, headers: { 'content-length': String(bytes.length) } });
        }
        const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range)!.map(Number);
        const end = Math.min(to, bytes.length - 1);
        return new Response(bytes.slice(from, end + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${end}/${bytes.length}` } });
    }) as unknown as typeof fetch;
    return { fetcher, requests };
}

describe('range downloads', () => {
    it('fetches a large file piece by piece and survives dropped pieces', async () => {
        vi.useFakeTimers();
        const bytes = file(PIECE * 3 + 1234);
        const server = rangeServer(bytes, new Set([2, 3]));
        const progress: number[] = [];
        const done = rangeDownload('u', 'k1', { fetcher: server.fetcher, onProgress: (p) => progress.push(p.done) });
        await vi.runAllTimersAsync();
        expect(await done).toEqual(bytes);
        expect(server.requests.length).toBe(4 + 2);
        expect(progress[progress.length - 1]).toBe(bytes.length);
    });

    it('keeps received pieces when it gives up and continues from there next time', async () => {
        vi.useFakeTimers();
        const bytes = file(PIECE * 2 + 10);
        // First piece arrives, then the link is gone for good.
        const dead = rangeServer(bytes, new Set([2, 3, 4, 5, 6, 7]));
        const first = rangeDownload('u', 'k2', { fetcher: dead.fetcher }).catch((error: Error) => error);
        await vi.runAllTimersAsync();
        expect(await first).toBeInstanceOf(Error);
        expect(partialBytes('k2')).toBe(PIECE);
        const back = rangeServer(bytes, new Set());
        const second = rangeDownload('u', 'k2', { fetcher: back.fetcher });
        await vi.runAllTimersAsync();
        expect(await second).toEqual(bytes);
        expect(back.requests[0]).toBe(`bytes=${PIECE}-${PIECE * 2 - 1}`);
        expect(partialBytes('k2')).toBe(0);
    });

    it('falls back to one request when the server ignores ranges', async () => {
        const bytes = file(1000);
        const server = rangeServer(bytes, new Set(), false);
        expect(await rangeDownload('u', 'k3', { fetcher: server.fetcher })).toEqual(bytes);
    });

    it('does not retry a missing file', async () => {
        const fetcher = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
        await expect(rangeDownload('u', 'k4', { fetcher })).rejects.toThrow('HTTP 404');
    });
});

describe('resumable uploads', () => {
    it('continues an interrupted upload from the offset the server reports', async () => {
        vi.useFakeTimers();
        const blob = new Blob([file(TUS_PIECE * 2 + 100)]);
        let stored = 0;
        let patches = 0;
        const log: string[] = [];
        const fetcher = (async (url: string, init: RequestInit) => {
            log.push(`${init.method} ${url}`);
            if (init.method === 'POST') {
                expect((init.headers as Record<string, string>)['Upload-Length']).toBe(String(blob.size));
                return new Response(null, { status: 201, headers: { location: '/upload/abc' } });
            }
            if (init.method === 'HEAD') {
                return new Response(null, { status: 200, headers: { 'upload-offset': String(stored) } });
            }
            patches += 1;
            if (patches === 2) {
                throw new TypeError('Failed to fetch');
            }
            const offset = Number((init.headers as Record<string, string>)['Upload-Offset']);
            expect(offset).toBe(stored);
            stored += (init.body as Blob).size;
            return new Response(null, { status: 204, headers: { 'upload-offset': String(stored) } });
        }) as unknown as typeof fetch;
        const target = { endpoint: 'https://x.supabase.co/storage/v1/upload/resumable', headers: {}, bucket: 'live-assets', object: 'p/h', contentType: 'image/png' };
        const done = tusUpload(target, blob, { fetcher });
        await vi.runAllTimersAsync();
        expect(await done).toBe('done');
        expect(stored).toBe(blob.size);
        expect(log.filter((line) => line.startsWith('POST'))).toHaveLength(1);
        expect(log.some((line) => line === 'HEAD https://x.supabase.co/upload/abc')).toBe(true);
    });

    it('reports an object that already exists', async () => {
        const fetcher = (async () => new Response(null, { status: 409 })) as unknown as typeof fetch;
        const target = { endpoint: 'https://x/storage/v1/upload/resumable', headers: {}, bucket: 'b', object: 'o', contentType: 'image/png' };
        expect(await tusUpload(target, new Blob([file(10)]), { fetcher })).toBe('exists');
    });
});
