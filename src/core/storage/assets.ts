import { db, type AssetRow } from './db';

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_IMAGE_EDGE = 4096;
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
    const row: AssetRow = {
        hash,
        blob: new Blob([bytes], { type: blob.type || 'application/octet-stream' }),
        mime: blob.type || 'application/octet-stream',
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
    await db.assets.put({ hash, blob: new Blob([copy], { type: mime }), mime, size: bytes.byteLength, name, createdAt: new Date().toISOString() });
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
    const originalHash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    if (longEdge <= MAX_IMAGE_EDGE && file.size <= 16 * 1024 * 1024) {
        bitmap.close();
        return { blob: file, width, height, originalHash, downscaled: false };
    }
    const scale = MAX_IMAGE_EDGE / longEdge;
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
    return { blob, width: w, height: h, originalHash, downscaled: true };
}
