/**
 * Large file transfer over weak mobile links (image maps, logos).
 *
 * Downloads go in byte ranges: a dropped or stalled connection costs one piece, and pieces
 * already received are kept (in memory) for the next attempt. Uploads to Supabase Storage use
 * its resumable TUS endpoint, so an interrupted upload continues from the last stored offset.
 */

export const PIECE = 512 * 1024;
const ATTEMPTS = 5;
/** No byte for this long: the connection is dead (mobile links stall silently). */
const STALL_MS = 30000;
export const MAX_TRANSFER = 40 * 1024 * 1024;

export interface TransferProgress {
    done: number;
    total: number | null;
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
    }, { once: true });
});

/** Read a response body with stall detection; `limit` guards against oversize answers. */
async function readBody(response: Response, limit: number, attempt: AbortController, onBytes: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let stall = setTimeout(() => attempt.abort(), STALL_MS);
    try {
        while (true) {
            const { value, done } = await reader.read();
            clearTimeout(stall);
            stall = setTimeout(() => attempt.abort(), STALL_MS);
            if (done) {
                break;
            }
            total += value.length;
            if (total > limit) {
                await reader.cancel();
                throw new Error('asset-too-large');
            }
            chunks.push(value);
            onBytes(value.length);
        }
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
const partial = new Map<string, { pieces: Uint8Array[]; total: number }>();

export function partialBytes(key: string): number {
    return partial.get(key)?.pieces.reduce((sum, piece) => sum + piece.length, 0) ?? 0;
}

/**
 * Download `url` in ranges of `PIECE` bytes. Falls back to one plain request when the server
 * ignores ranges. Each piece is retried with growing pauses; a stalled piece is cut and retried.
 */
export async function rangeDownload(url: string, key: string, options: { signal?: AbortSignal; onProgress?: (progress: TransferProgress) => void; fetcher?: typeof fetch } = {}): Promise<Uint8Array<ArrayBuffer>> {
    const fetcher = options.fetcher ?? fetch;
    const state = partial.get(key) ?? { pieces: [], total: -1 };
    partial.set(key, state);
    let received = state.pieces.reduce((sum, piece) => sum + piece.length, 0);
    options.onProgress?.({ done: received, total: state.total >= 0 ? state.total : null });
    let failures = 0;
    while (state.total < 0 || received < state.total) {
        options.signal?.throwIfAborted();
        const attempt = new AbortController();
        const cancel = () => attempt.abort();
        options.signal?.addEventListener('abort', cancel, { once: true });
        try {
            const end = received + PIECE - 1;
            const response = await fetcher(url, { headers: { Range: `bytes=${received}-${end}` }, signal: attempt.signal });
            if (response.status === 416 && state.total < 0 && received === 0) {
                // Empty file.
                state.total = 0;
                break;
            }
            if (response.status === 200) {
                // Ranges not supported: the whole file in one go.
                const length = Number(response.headers.get('content-length'));
                if (length > MAX_TRANSFER) {
                    throw new Error('asset-too-large');
                }
                let streamed = 0;
                const body = await readBody(response, MAX_TRANSFER, attempt, (n) => {
                    streamed += n;
                    options.onProgress?.({ done: streamed, total: length || null });
                });
                partial.delete(key);
                return body;
            }
            if (response.status !== 206) {
                if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
                    // Missing or forbidden: no point retrying.
                    partial.delete(key);
                    throw Object.assign(new Error(`HTTP ${response.status}`), { permanent: true });
                }
                throw new Error(`HTTP ${response.status}`);
            }
            const range = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(response.headers.get('content-range') ?? '');
            if (!range || Number(range[1]) !== received) {
                throw new Error('range');
            }
            const total = range[3] === '*' ? -1 : Number(range[3]);
            if (total > MAX_TRANSFER) {
                partial.delete(key);
                throw Object.assign(new Error('asset-too-large'), { permanent: true });
            }
            state.total = total;
            const piece = await readBody(response, PIECE * 2, attempt, (n) => {
                options.onProgress?.({ done: received + n, total: total >= 0 ? total : null });
            });
            if (piece.length === 0) {
                throw new Error('range');
            }
            state.pieces.push(piece);
            received += piece.length;
            failures = 0;
            options.onProgress?.({ done: received, total: total >= 0 ? total : null });
            if (total < 0 && piece.length < PIECE) {
                state.total = received;
            }
        } catch (error) {
            if (options.signal?.aborted || (error as { permanent?: boolean }).permanent || (error instanceof Error && error.message === 'asset-too-large')) {
                throw error;
            }
            failures += 1;
            if (failures >= ATTEMPTS) {
                // Keep what arrived: the next attempt continues from here.
                throw error instanceof Error ? error : new Error('download');
            }
            await wait(1000 * 3 ** (failures - 1), options.signal);
        } finally {
            options.signal?.removeEventListener('abort', cancel);
        }
    }
    const out = new Uint8Array(received);
    let at = 0;
    for (const piece of state.pieces) {
        out.set(piece, at);
        at += piece.length;
    }
    partial.delete(key);
    return out;
}

export interface TusTarget {
    /** `https://<project>.supabase.co/storage/v1/upload/resumable` */
    endpoint: string;
    headers: Record<string, string>;
    bucket: string;
    object: string;
    contentType: string;
}

/** Upload URLs of unfinished uploads, by object: a retry asks the server where to continue. */
const uploads = new Map<string, string>();

const b64 = (text: string) => btoa(unescape(encodeURIComponent(text)));

/** Supabase requires 6 MB pieces for resumable uploads. */
export const TUS_PIECE = 6 * 1024 * 1024;

/**
 * Resumable upload (TUS 1.0.0, as offered by Supabase Storage). Returns when the server holds
 * all bytes; `exists` when the object was already there.
 */
export async function tusUpload(target: TusTarget, blob: Blob, options: { signal?: AbortSignal; onProgress?: (progress: TransferProgress) => void; fetcher?: typeof fetch } = {}): Promise<'done' | 'exists'> {
    const fetcher = options.fetcher ?? fetch;
    const base = { ...target.headers, 'Tus-Resumable': '1.0.0' };
    const key = `${target.bucket}/${target.object}`;
    let failures = 0;
    while (true) {
        options.signal?.throwIfAborted();
        try {
            let location = uploads.get(key);
            let offset = 0;
            if (location) {
                const head = await fetcher(location, { method: 'HEAD', headers: base, signal: options.signal });
                if (head.ok) {
                    offset = Number(head.headers.get('upload-offset') ?? 0);
                } else {
                    uploads.delete(key);
                    location = undefined;
                }
            }
            if (!location) {
                const created = await fetcher(target.endpoint, {
                    method: 'POST',
                    signal: options.signal,
                    headers: {
                        ...base,
                        'Upload-Length': String(blob.size),
                        'Upload-Metadata': [`bucketName ${b64(target.bucket)}`, `objectName ${b64(target.object)}`, `contentType ${b64(target.contentType)}`, `cacheControl ${b64('3600')}`].join(','),
                    },
                });
                if (created.status === 409) {
                    return 'exists';
                }
                if (created.status !== 201 || !created.headers.get('location')) {
                    const error = new Error(`HTTP ${created.status}`);
                    throw created.status >= 400 && created.status < 500 && created.status !== 408 && created.status !== 429 ? Object.assign(error, { permanent: true }) : error;
                }
                location = new URL(created.headers.get('location')!, target.endpoint).toString();
                uploads.set(key, location);
            }
            while (offset < blob.size) {
                options.signal?.throwIfAborted();
                const piece = blob.slice(offset, offset + TUS_PIECE);
                const patched = await fetcher(location, {
                    method: 'PATCH',
                    signal: options.signal,
                    headers: { ...base, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
                    body: piece,
                });
                if (patched.status === 409) {
                    // Offset mismatch: ask the server again.
                    throw new Error('offset');
                }
                if (patched.status !== 204 && patched.status !== 200) {
                    throw new Error(`HTTP ${patched.status}`);
                }
                offset = Number(patched.headers.get('upload-offset') ?? offset + piece.size);
                failures = 0;
                options.onProgress?.({ done: offset, total: blob.size });
            }
            uploads.delete(key);
            return 'done';
        } catch (error) {
            if (options.signal?.aborted || (error as { permanent?: boolean }).permanent) {
                throw error;
            }
            failures += 1;
            if (failures >= ATTEMPTS) {
                throw error;
            }
            await wait(1000 * 3 ** (failures - 1), options.signal);
        }
    }
}
