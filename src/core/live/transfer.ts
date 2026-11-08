/**
 * Large file transfer over weak mobile links (image maps, logos).
 *
 * Downloads go in byte ranges: a dropped or stalled connection costs one piece, and pieces
 * already received are kept (in memory, within a budget) for the next attempt. Uploads to
 * Supabase Storage use its resumable TUS endpoint, so an interrupted upload continues from the
 * last stored offset. Every request has a first-byte limit and a stall limit: a dead mobile
 * connection (cell change, NAT timeout) never hangs a transfer.
 */

export const PIECE = 512 * 1024;
const ATTEMPTS = 5;
/** Waiting for the first byte of an answer (plus the time to send the request body). */
const FIRST_BYTE_MS = 60000;
/** Then: no byte for this long means the connection is dead (mobile links stall silently). */
const STALL_MS = 30000;
/** Sending a request body: assume at least this many bytes per second. */
const UPLINK_FLOOR = 1024;
export const MAX_TRANSFER = 40 * 1024 * 1024;
/** Pieces of unfinished downloads kept in memory, across all files. */
const PARTIAL_BUDGET = 80 * 1024 * 1024;

export interface TransferProgress {
    done: number;
    total: number | null;
}

/** A failure that a retry would only repeat (missing file, refused). */
const permanent = (message: string) => Object.assign(new Error(message), { permanent: true });
const isPermanent = (error: unknown) => Boolean((error as { permanent?: boolean } | null)?.permanent);

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
});

/**
 * One request with a first-byte limit; the returned `attempt` controller lets the body reader
 * cut a stalled answer. The caller's signal still cancels everything.
 */
async function request(fetcher: typeof fetch, url: string, init: RequestInit, sendBytes: number, signal?: AbortSignal): Promise<{ response: Response; attempt: AbortController; done: () => void }> {
    const attempt = new AbortController();
    const cancel = () => attempt.abort(signal?.reason);
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException('aborted', 'AbortError');
    }
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => attempt.abort(new DOMException('stalled', 'TimeoutError')), FIRST_BYTE_MS + (sendBytes * 1000) / UPLINK_FLOOR);
    const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    };
    try {
        const response = await fetcher(url, { ...init, signal: attempt.signal });
        clearTimeout(timer);
        return { response, attempt, done };
    } catch (error) {
        done();
        throw signal?.aborted ? error : attempt.signal.aborted ? new Error('stalled') : error;
    }
}

/** Read a body with stall detection; `limit` guards against oversize answers. */
async function readBody(response: Response, limit: number, attempt: AbortController, onBytes: (total: number) => void): Promise<Uint8Array<ArrayBuffer>> {
    if (!response.body) {
        return new Uint8Array(0);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let stall = setTimeout(() => attempt.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
    try {
        while (true) {
            const { value, done } = await reader.read();
            clearTimeout(stall);
            stall = setTimeout(() => attempt.abort(new DOMException('stalled', 'TimeoutError')), STALL_MS);
            if (done) {
                break;
            }
            total += value.length;
            if (total > limit) {
                await reader.cancel();
                throw permanent('asset-too-large');
            }
            chunks.push(value);
            onBytes(total);
        }
    } catch (error) {
        throw attempt.signal.aborted && !isPermanent(error) ? new Error('stalled') : error;
    } finally {
        clearTimeout(stall);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}

/** Pieces received so far, by key: an interrupted download continues from here. */
const partial = new Map<string, { pieces: Uint8Array[]; total: number; used: number }>();
/** Downloads running, by key: a second caller shares the first one instead of competing. */
const running = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

export function partialBytes(key: string): number {
    return partial.get(key)?.pieces.reduce((sum, piece) => sum + piece.length, 0) ?? 0;
}

/** Keep the kept pieces within budget: drop the least recently used unfinished downloads. */
function trimPartial(keep: string) {
    let total = [...partial.values()].reduce((sum, state) => sum + state.pieces.reduce((s, p) => s + p.length, 0), 0);
    for (const [key, state] of [...partial.entries()].sort((a, b) => a[1].used - b[1].used)) {
        if (total <= PARTIAL_BUDGET) {
            break;
        }
        if (key !== keep) {
            total -= state.pieces.reduce((s, p) => s + p.length, 0);
            partial.delete(key);
        }
    }
}

export interface DownloadOptions {
    signal?: AbortSignal;
    onProgress?: (progress: TransferProgress) => void;
    fetcher?: typeof fetch;
}

/**
 * Download `url` in ranges of `PIECE` bytes. Falls back to one plain request when the server
 * ignores ranges. Each piece is retried with growing pauses; a stalled piece is cut and retried.
 * `url` may be a function: it is asked again when the server refuses the old one (an expired
 * signed link), and the download continues where it was.
 */
export function rangeDownload(url: string | (() => Promise<string>), key: string, options: DownloadOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
    const existing = running.get(key);
    if (existing) {
        return existing;
    }
    const job = download(url, key, options).finally(() => running.delete(key));
    running.set(key, job);
    return job;
}

async function download(source: string | (() => Promise<string>), key: string, options: DownloadOptions): Promise<Uint8Array<ArrayBuffer>> {
    const fetcher = options.fetcher ?? fetch;
    const state = partial.get(key) ?? { pieces: [], total: -1, used: Date.now() };
    state.used = Date.now();
    partial.set(key, state);
    let received = state.pieces.reduce((sum, piece) => sum + piece.length, 0);
    let url = typeof source === 'string' ? source : await source();
    let renewals = 0;
    options.onProgress?.({ done: received, total: state.total >= 0 ? state.total : null });
    let failures = 0;
    while (state.total < 0 || received < state.total) {
        options.signal?.throwIfAborted();
        let finish = () => undefined as void;
        try {
            const end = received + PIECE - 1;
            const { response, attempt, done } = await request(fetcher, url, { headers: { Range: `bytes=${received}-${end}` } }, 0, options.signal);
            finish = done;
            if (response.status === 416 && received > 0) {
                // Asked past the end: what we have is the whole file (exact multiple of a piece).
                void response.body?.cancel().catch(() => undefined);
                state.total = received;
                break;
            }
            if (response.status === 416 && received === 0) {
                state.total = 0;
                break;
            }
            if (response.status === 200) {
                // Ranges not supported: the whole file in one go. When pieces are already here,
                // the answer must be the same file (a captive portal page is not).
                const length = Number(response.headers.get('content-length'));
                if (length > MAX_TRANSFER) {
                    throw permanent('asset-too-large');
                }
                const body = await readBody(response, MAX_TRANSFER, attempt, (n) => options.onProgress?.({ done: n, total: length || null }));
                if (state.total >= 0 && body.length !== state.total) {
                    throw new Error('range');
                }
                partial.delete(key);
                return body;
            }
            if (response.status !== 206) {
                void response.body?.cancel().catch(() => undefined);
                if (response.status === 404 || response.status === 410) {
                    partial.delete(key);
                    throw permanent(`HTTP ${response.status}`);
                }
                if ((response.status === 400 || response.status === 401 || response.status === 403) && typeof source === 'function' && renewals < 3) {
                    // Most likely the signed link expired on a slow link: get a new one, keep the pieces.
                    renewals += 1;
                    url = await source();
                    continue;
                }
                if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                    throw permanent(`HTTP ${response.status}`);
                }
                throw new Error(`HTTP ${response.status}`);
            }
            const range = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(response.headers.get('content-range') ?? '');
            if (range && Number(range[1]) !== received) {
                void response.body?.cancel().catch(() => undefined);
                throw new Error('range');
            }
            // Without a readable Content-Range (header not exposed by CORS): take the piece and treat
            // a short one as the end.
            const total = range && range[3] !== '*' ? Number(range[3]) : -1;
            if (total > MAX_TRANSFER) {
                void response.body?.cancel().catch(() => undefined);
                partial.delete(key);
                throw permanent('asset-too-large');
            }
            const piece = await readBody(response, PIECE * 2, attempt, (n) => options.onProgress?.({ done: received + n, total: total >= 0 ? total : null }));
            if (piece.length === 0) {
                throw new Error('range');
            }
            state.total = total;
            state.pieces.push(piece);
            state.used = Date.now();
            received += piece.length;
            failures = 0;
            trimPartial(key);
            if (received > MAX_TRANSFER) {
                partial.delete(key);
                throw permanent('asset-too-large');
            }
            options.onProgress?.({ done: received, total: total >= 0 ? total : null });
            if (total < 0 && piece.length < PIECE) {
                state.total = received;
            }
        } catch (error) {
            if (options.signal?.aborted || isPermanent(error)) {
                throw error;
            }
            failures += 1;
            if (failures >= ATTEMPTS) {
                // Keep what arrived: the next attempt continues from here.
                throw error instanceof Error ? error : new Error('download');
            }
            await wait(1000 * 3 ** (failures - 1), options.signal);
        } finally {
            finish();
        }
    }
    const out = new Uint8Array(received);
    let at = 0;
    for (const piece of state.pieces) {
        out.set(piece, at);
        at += piece.length;
    }
    partial.delete(key);
    if (at !== received || (state.total >= 0 && received !== state.total)) {
        throw new Error('range');
    }
    return out;
}

export interface TusTarget {
    /** `https://<project>.supabase.co/storage/v1/upload/resumable` */
    endpoint: string;
    /** Asked before every attempt (tokens expire during long uploads). */
    headers: () => Promise<Record<string, string>>;
    bucket: string;
    object: string;
    contentType: string;
}

/** Upload URLs of unfinished uploads, by object: a retry asks the server where to continue. */
const uploads = new Map<string, string>();

const b64 = (text: string) => btoa(unescape(encodeURIComponent(text)));

/** Supabase requires 6 MB pieces for resumable uploads. */
export const TUS_PIECE = 6 * 1024 * 1024;

function offsetOf(response: Response, size: number): number {
    const offset = Number(response.headers.get('upload-offset'));
    if (!Number.isInteger(offset) || offset < 0 || offset > size) {
        throw new Error('offset');
    }
    return offset;
}

/**
 * Resumable upload (TUS 1.0.0, as offered by Supabase Storage). Returns when the server holds
 * all bytes; `exists` when the object was already there (e.g. another device uploaded it).
 */
export async function tusUpload(target: TusTarget, blob: Blob, options: { signal?: AbortSignal; onProgress?: (progress: TransferProgress) => void; fetcher?: typeof fetch } = {}): Promise<'done' | 'exists'> {
    const fetcher = options.fetcher ?? fetch;
    const key = `${target.bucket}/${target.object}`;
    const origin = new URL(target.endpoint).origin;
    let failures = 0;
    while (true) {
        options.signal?.throwIfAborted();
        const base = { ...(await target.headers()), 'Tus-Resumable': '1.0.0' };
        const cleanup: (() => void)[] = [];
        try {
            let location = uploads.get(key);
            let offset = 0;
            if (location) {
                const head = await request(fetcher, location, { method: 'HEAD', headers: base }, 0, options.signal);
                cleanup.push(head.done);
                if (head.response.ok) {
                    offset = offsetOf(head.response, blob.size);
                } else if (head.response.status === 404 || head.response.status === 410 || head.response.status === 403) {
                    // The server forgot this upload: start a new one.
                    uploads.delete(key);
                    location = undefined;
                } else {
                    // Busy, locked (423) or overloaded: the upload still exists, ask again later.
                    throw new Error(`HTTP ${head.response.status}`);
                }
            }
            if (!location) {
                const created = await request(fetcher, target.endpoint, {
                    method: 'POST',
                    headers: {
                        ...base,
                        'Upload-Length': String(blob.size),
                        'Upload-Metadata': [`bucketName ${b64(target.bucket)}`, `objectName ${b64(target.object)}`, `contentType ${b64(target.contentType)}`, `cacheControl ${b64('3600')}`].join(','),
                    },
                }, 0, options.signal);
                cleanup.push(created.done);
                if (created.response.status === 409) {
                    return 'exists';
                }
                const header = created.response.headers.get('location');
                if (created.response.status !== 201 || !header) {
                    const message = `HTTP ${created.response.status}`;
                    throw created.response.status >= 400 && created.response.status < 500 && ![408, 423, 429].includes(created.response.status) ? permanent(message) : new Error(message);
                }
                const resolved = new URL(header, target.endpoint);
                // The bearer token only ever goes to the storage server it was meant for.
                if (resolved.origin !== origin) {
                    throw permanent('location');
                }
                location = resolved.toString();
                uploads.set(key, location);
            }
            while (offset < blob.size) {
                options.signal?.throwIfAborted();
                const piece = blob.slice(offset, offset + TUS_PIECE);
                const patched = await request(fetcher, location, {
                    method: 'PATCH',
                    headers: { ...base, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
                    body: piece,
                }, piece.size, options.signal);
                cleanup.push(patched.done);
                void patched.response.body?.cancel().catch(() => undefined);
                if (patched.response.status === 409) {
                    // Either our offset is stale (ask the server), or another device finished the same
                    // object first (Supabase re-checks "already exists" on every piece).
                    const head = await request(fetcher, location, { method: 'HEAD', headers: base }, 0, options.signal);
                    cleanup.push(head.done);
                    const server = head.response.ok ? offsetOf(head.response, blob.size) : -1;
                    if (server >= 0 && server !== offset) {
                        offset = server;
                        continue;
                    }
                    uploads.delete(key);
                    throw new Error('conflict');
                }
                if (patched.response.status !== 204 && patched.response.status !== 200) {
                    throw new Error(`HTTP ${patched.response.status}`);
                }
                const next = offsetOf(patched.response, blob.size);
                if (next <= offset) {
                    throw new Error('offset');
                }
                offset = next;
                failures = 0;
                options.onProgress?.({ done: offset, total: blob.size });
            }
            uploads.delete(key);
            return 'done';
        } catch (error) {
            if (options.signal?.aborted || isPermanent(error)) {
                throw error;
            }
            failures += 1;
            if (failures >= ATTEMPTS) {
                throw error;
            }
            await wait(1000 * 3 ** (failures - 1), options.signal);
        } finally {
            cleanup.forEach((done) => done());
        }
    }
}
