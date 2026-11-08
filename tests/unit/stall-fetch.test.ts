import { afterEach, describe, expect, it, vi } from 'vitest';
import { stallFetch } from '../../src/core/live/supabase';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/** A response body that sends `pieces` chunks, one every `everyMs`, then (optionally) goes silent. */
function slowServer(pieces: number, everyMs: number, silentAfter = Infinity) {
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
        // Like the real fetch: an already aborted request never starts.
        init.signal?.throwIfAborted();
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
            async pull(sink) {
                if (sent >= silentAfter) {
                    // Dead link: nothing more ever arrives (until aborted).
                    await new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
                }
                await new Promise((resolve) => setTimeout(resolve, everyMs));
                if (sent >= pieces) {
                    sink.close();
                    return;
                }
                sent += 1;
                sink.enqueue(new Uint8Array(1000));
            },
        });
        return new Response(body, { status: 200 });
    }));
}

describe('stall-based cut-off for Supabase requests', () => {
    it('lets a slow but steady answer finish, however long it takes', async () => {
        vi.useFakeTimers();
        // 40 pieces, one every 20 s: 13 minutes, far beyond any fixed deadline.
        slowServer(40, 20000);
        const done = stallFetch('https://x/rest/v1/live_entities').then((response) => response.arrayBuffer());
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
        expect((await done).byteLength).toBe(40000);
    });

    it('cuts an answer that stops arriving', async () => {
        vi.useFakeTimers();
        slowServer(40, 1000, 3);
        const done = stallFetch('https://x/rest/v1/live_entities').then((response) => response.arrayBuffer()).catch((error: Error) => error);
        await vi.advanceTimersByTimeAsync(60 * 1000);
        const result = await done;
        expect(result).toBeInstanceOf(Error);
    });

    it('passes a caller abort through', async () => {
        slowServer(5, 10);
        const controller = new AbortController();
        controller.abort();
        await expect(stallFetch('https://x', { signal: controller.signal }).then((r) => r.arrayBuffer())).rejects.toBeTruthy();
    });
});
