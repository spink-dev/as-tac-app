import { zipSync } from 'fflate';

export const ARCHIVE_LIMIT = 100 * 1024 * 1024;
export const ENTRY_LIMIT = 32 * 1024 * 1024;
const TOTAL_LIMIT = 64 * 1024 * 1024;
export const PATHS = ['manifest.json', 'project.json', 'maps/area.json', 'credits/ODbL-1.0.txt', 'credits/CREDITS.md', 'credits/renderer.json'] as const;
const decoder = new TextDecoder('utf-8', { fatal: true });
export function encode(value: unknown) {
    return new TextEncoder().encode(JSON.stringify(value));
}
export async function digest(bytes: Uint8Array) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function pack(files: Record<string, Uint8Array>) {
    if (Object.values(files).some((b) => b.length > ENTRY_LIMIT) || Object.values(files).reduce((n, b) => n + b.length, 0) > TOTAL_LIMIT) {
        throw new Error('size');
    }
    return zipSync(files, { level: 6 });
}
/** Strict v1 ZIP subset: fixed paths, single disk, no encryption/ZIP64/descriptors.
 * Validate the complete directory before streaming any decompression. Never trust declared sizes.
 */
export async function unpack(bytes: Uint8Array, signal: AbortSignal): Promise<Record<string, Uint8Array>> {
    if (bytes.length > ARCHIVE_LIMIT || bytes.length < 22) {
        throw new Error('size');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (n: number) => view.getUint16(n, true);
    const u32 = (n: number) => view.getUint32(n, true);
    const end = bytes.length - 22;
    if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20)
        || u16(end + 8) !== PATHS.length || u16(end + 10) !== PATHS.length
        || u32(end + 16) + u32(end + 12) !== end) {
        throw new Error('archive');
    }
    let directory = u32(end + 16);
    let local = 0;
    let declared = 0;
    const entries: { name: string; start: number; size: number; expanded: number; method: number }[] = [];
    const names = new Set<string>();
    for (let i = 0; i < PATHS.length; i++) {
        if (directory + 46 > end || u32(directory) !== 0x02014b50) {
            throw new Error('archive');
        }
        const flags = u16(directory + 8);
        const method = u16(directory + 10);
        const size = u32(directory + 20);
        const expanded = u32(directory + 24);
        const length = u16(directory + 28);
        const next = directory + 46 + length + u16(directory + 30) + u16(directory + 32);
        const name = decoder.decode(bytes.subarray(directory + 46, directory + 46 + length));
        declared += expanded;
        if (next > end || !PATHS.includes(name as typeof PATHS[number]) || names.has(name)
            || flags & ~0x800 || ![0, 8].includes(method) || expanded > ENTRY_LIMIT || declared > TOTAL_LIMIT
            || u16(directory + 34) || u32(directory + 42) !== local
            || local + 30 > u32(end + 16) || u32(local) !== 0x04034b50
            || u16(local + 6) !== flags || u16(local + 8) !== method
            || u32(local + 14) !== u32(directory + 16)
            || u32(local + 18) !== size || u32(local + 22) !== expanded
            || u16(local + 26) !== length) {
            throw new Error('archive');
        }
        const start = local + 30 + length + u16(local + 28);
        if (start + size > u32(end + 16) || decoder.decode(bytes.subarray(local + 30, local + 30 + length)) !== name) {
            throw new Error('archive');
        }
        names.add(name);
        entries.push({ name, start, size, expanded, method });
        local = start + size;
        directory = next;
    }
    if (directory !== end || local !== u32(end + 16)) {
        throw new Error('archive');
    }
    const files: Record<string, Uint8Array> = Object.create(null);
    let total = 0;
    for (const entry of entries) {
        signal.throwIfAborted();
        const input = new Uint8Array(bytes.subarray(entry.start, entry.start + entry.size));
        const stream = new Blob([input]).stream();
        const reader = (entry.method === 8 ? stream.pipeThrough(new DecompressionStream('deflate-raw')) : stream).getReader();
        const chunks: Uint8Array[] = [];
        let count = 0;
        try {
            while (true) {
                signal.throwIfAborted();
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                count += value.length;
                total += value.length;
                if (count > entry.expanded || count > ENTRY_LIMIT || total > TOTAL_LIMIT) {
                    throw new Error('size');
                }
                chunks.push(value);
            }
        } finally {
            await reader.cancel().catch(() => {
                // Preserve the original decompression or cancellation error.
            });
        }
        if (count !== entry.expanded) {
            throw new Error('archive');
        }
        const result = new Uint8Array(count);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        files[entry.name] = result;
    }
    return files;
}
