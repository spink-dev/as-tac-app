import { db, type AssetRow } from './db';

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_IMAGE_EDGE = 4096;

/** Only passive content types may live in the asset store; anything else is stored inert. */
export const SAFE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain'] as const;

export function safeMime(mime: string | undefined): string {
    const normalized = (mime ?? '').toLowerCase().split(';')[0].trim();
    return (SAFE_MIME as readonly string[]).includes(normalized) ? normalized : 'application/octet-stream';
}
const MAX_ASSET_BYTES = 40 * 1024 * 1024;

export async function putAsset(blob: Blob, name?: string, extra: Partial<AssetRow> = {}): Promise<AssetRow> {
    if (blob.size > MAX_ASSET_BYTES) {
        throw new Error('asset-too-large');
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const hash = await sha256Hex(bytes);
    const existing = await db.assets.get(hash);
    if (existing) {
        return existing;
    }
    const mime = safeMime(blob.type);
    const row: AssetRow = {
        hash,
        blob: new Blob([bytes], { type: mime }),
        mime,
        size: bytes.byteLength,
        name,
        createdAt: new Date().toISOString(),
        ...extra,
    };
    await db.assets.put(row);
    return row;
}

/** Store a verified asset whose hash is already known (archive import). */
export async function putVerifiedAsset(hash: string, bytes: Uint8Array, mime: string, name?: string): Promise<void> {
    const actual = await sha256Hex(bytes);
    if (actual !== hash) {
        throw new Error('asset-checksum');
    }
    if (await db.assets.get(hash)) {
        return;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const type = safeMime(mime);
    await db.assets.put({ hash, blob: new Blob([copy], { type }), mime: type, size: bytes.byteLength, name, createdAt: new Date().toISOString() });
}

export async function getAsset(hash: string): Promise<AssetRow | undefined> {
    return db.assets.get(hash);
}

const urlCache = new Map<string, string>();

export async function assetUrl(hash: string): Promise<string | null> {
    const cached = urlCache.get(hash);
    if (cached) {
        return cached;
    }
    const row = await db.assets.get(hash);
    if (!row) {
        return null;
    }
    const url = URL.createObjectURL(row.blob);
    urlCache.set(hash, url);
    return url;
}

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;

/** Width and height from the PNG, JPEG, GIF or WebP header; `null` for anything else. */
export function imageDimensions(b: Uint8Array): { width: number; height: number } | null {
    const u16be = (i: number) => (b[i] << 8) | b[i + 1];
    const u16le = (i: number) => b[i] | (b[i + 1] << 8);
    const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
    if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === 'PNG') {
        return { width: ((b[16] << 24) >>> 0) + (b[17] << 16) + (b[18] << 8) + b[19], height: ((b[20] << 24) >>> 0) + (b[21] << 16) + (b[22] << 8) + b[23] };
    }
    if (b.length >= 10 && ascii(0, 4) === 'GIF8') {
        return { width: u16le(6), height: u16le(8) };
    }
    if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
        const chunk = ascii(12, 4);
        if (chunk === 'VP8 ') {
            return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
        }
        if (chunk === 'VP8L') {
            const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
            return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
        }
        if (chunk === 'VP8X') {
            return { width: 1 + u24le(24), height: 1 + u24le(27) };
        }
        return null;
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
        let i = 2;
        while (i + 9 < b.length) {
            if (b[i] !== 0xff) {
                i += 1;
                continue;
            }
            const marker = b[i + 1];
            if (marker === 0xff) {
                i += 1;
                continue;
            }
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { width: u16be(i + 7), height: u16be(i + 5) };
            }
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
                i += 2;
                continue;
            }
            i += 2 + u16be(i + 2);
        }
        return null;
    }
    return null;
}

export interface PreparedImage {
    blob: Blob;
    width: number;
    height: number;
    originalHash: string;
    downscaled: boolean;
}

/**
 * Imported images keep their original bytes when they already fit (so known event maps keep
 * their fingerprint); oversized images are downscaled to a 4096 px long edge for phones.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
    if (file.size > MAX_INPUT_BYTES) {
        throw new Error('image-too-large');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Read the header first: a small file can still decode into gigabytes (decompression bomb).
    const size = imageDimensions(bytes);
    if (!size) {
        throw new Error('image-format');
    }
    if (size.width > 16384 || size.height > 16384 || size.width * size.height > MAX_PIXELS) {
        throw new Error('image-too-large');
    }
    const originalHash = await sha256Hex(bytes);
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    const keepable = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type);
    if (keepable && longEdge <= MAX_IMAGE_EDGE && file.size <= 16 * 1024 * 1024) {
        bitmap.close();
        return { blob: file, width, height, originalHash, downscaled: false };
    }
    const scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('canvas');
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
    return { blob, width: w, height: h, originalHash, downscaled: scale < 1 };
}
