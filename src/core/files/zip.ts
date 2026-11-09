import { zipSync } from 'fflate';

/** Limits for reading untrusted archives (.astac, .tacmap, as-tac 0.x .astac.zip). */
export interface ZipLimits {
    maxArchive: number;
    maxEntries: number;
    maxEntry: number;
    maxTotal: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
    maxArchive: 128 * 1024 * 1024,
    maxEntries: 600,
    maxEntry: 64 * 1024 * 1024,
    maxTotal: 256 * 1024 * 1024,
};

const SAFE_NAME = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+){0,3}$/;

export function isZip(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function packZip(files: Record<string, Uint8Array>): Uint8Array {
    return zipSync(files, { level: 6 });
}

/**
 * Strict ZIP reader for the subset our writers (fflate) produce: single disk, no encryption,
 * no ZIP64, no data descriptors, stored or deflate. The whole central directory is checked
 * before anything is inflated, and declared sizes are never trusted: inflation is streamed
 * and stops at the declared size and the entry/total limits (zip bombs).
 */
export async function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS, signal?: AbortSignal): Promise<Map<string, Uint8Array>> {
    if (bytes.length > limits.maxArchive) {
        throw new Error('archive-too-large');
    }
    if (bytes.length < 22) {
        throw new Error('archive');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (n: number) => view.getUint16(n, true);
    const u32 = (n: number) => view.getUint32(n, true);
    // End of central directory: allow a trailing comment of up to 64 KiB.
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
        if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
            end = i;
            break;
        }
    }
    if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) {
        throw new Error('archive');
    }
    const count = u16(end + 10);
    const dirSize = u32(end + 12);
    const dirStart = u32(end + 16);
    if (count === 0 || count > limits.maxEntries || dirStart + dirSize !== end) {
        throw new Error(count > limits.maxEntries ? 'archive-too-many' : 'archive');
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const entries: { name: string; start: number; size: number; expanded: number; method: number }[] = [];
    const names = new Set<string>();
    let declared = 0;
    let p = dirStart;
    for (let i = 0; i < count; i++) {
        if (p + 46 > end || u32(p) !== 0x02014b50) {
            throw new Error('archive');
        }
        const flags = u16(p + 8);
        const method = u16(p + 10);
        const size = u32(p + 20);
        const expanded = u32(p + 24);
        const nameLength = u16(p + 28);
        const next = p + 46 + nameLength + u16(p + 30) + u16(p + 32);
        const local = u32(p + 42);
        const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
        declared += expanded;
        if (next > end || (flags & ~0x800) !== 0 || (method !== 0 && method !== 8) || u16(p + 34) !== 0
            || size === 0xffffffff || expanded === 0xffffffff || local + 30 > dirStart || u32(local) !== 0x04034b50
            || u16(local + 8) !== method || u32(local + 18) !== size || u32(local + 22) !== expanded || u16(local + 26) !== nameLength) {
            throw new Error('archive');
        }
        if (expanded > limits.maxEntry || declared > limits.maxTotal) {
            throw new Error('archive-too-large');
        }
        const isDir = name.endsWith('/');
        if (!isDir) {
            if (!SAFE_NAME.test(name) || name.split('/').some((part) => part === '.' || part === '..') || names.has(name)) {
                throw new Error('archive');
            }
            const start = local + 30 + nameLength + u16(local + 28);
            if (start + size > dirStart || decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== name) {
                throw new Error('archive');
            }
            names.add(name);
            entries.push({ name, start, size, expanded, method });
        }
        p = next;
    }
    if (p !== end) {
        throw new Error('archive');
    }
    const files = new Map<string, Uint8Array>();
    let total = 0;
    for (const entry of entries) {
        signal?.throwIfAborted();
        const input = bytes.slice(entry.start, entry.start + entry.size);
        if (entry.method === 0) {
            if (entry.size !== entry.expanded) {
                throw new Error('archive');
            }
            total += input.length;
            files.set(entry.name, input);
            continue;
        }
        const out = await inflateCapped(input, entry.expanded, limits.maxTotal - total, signal);
        if (out.length !== entry.expanded) {
            throw new Error('archive');
        }
        total += out.length;
        files.set(entry.name, out);
    }
    return files;
}

const SLICE = 4 * 1024;

/**
 * Inflate raw deflate data with hard output caps. The input is fed in small slices from a
 * pull-based stream, so a bomb is stopped after a few slices instead of after the browser has
 * inflated the whole compressed blob in one go.
 */
export async function inflateCapped(input: Uint8Array, maxOut: number, budget = maxOut, signal?: AbortSignal): Promise<Uint8Array> {
    let offset = 0;
    const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
            if (offset >= input.length) {
                controller.close();
                return;
            }
            controller.enqueue(input.slice(offset, offset + SLICE));
            offset += SLICE;
        },
    }, { highWaterMark: 0 });
    const reader = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array<ArrayBuffer>>).getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            signal?.throwIfAborted();
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            length += value.length;
            if (length > maxOut || length > budget) {
                throw new Error('archive-too-large');
            }
            chunks.push(value);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}

export function readJson(files: Map<string, Uint8Array>, name: string): unknown {
    const bytes = files.get(name);
    if (!bytes) {
        throw new Error(`missing:${name}`);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
