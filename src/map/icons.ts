import type { Map as MlMap } from 'maplibre-gl';
import { getAsset } from '../core/storage/assets';

const RATIO = 2;

export const UNIT_SYMBOLS = [
    'infantry', 'recon', 'sniper', 'support', 'medic', 'hq', 'vehicle', 'engineer', 'signal', 'mortar', 'star', 'chevron', 'skull', 'shield', 'bolt', 'crown',
] as const;
export type UnitSymbol = typeof UNIT_SYMBOLS[number];

const STATUS_COLORS: Record<string, string> = {
    unknown: '#8a9097', enemy: '#d0343c', contested: '#e09a1a', secured: '#2f9d5e', lost: '#5b5f66',
};

function canvas(size: number) {
    const c = document.createElement('canvas');
    c.width = size * RATIO;
    c.height = size * RATIO;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.scale(RATIO, RATIO);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    return { c, ctx };
}

function toImage(c: HTMLCanvasElement) {
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    return { width: c.width, height: c.height, data: new Uint8Array(ctx.getImageData(0, 0, c.width, c.height).data.buffer) };
}

function contrastInk(hex: string): string {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14181b' : '#ffffff';
}

function drawUnitGlyph(ctx: CanvasRenderingContext2D, symbol: string, x: number, y: number, w: number, h: number, ink: string) {
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (symbol.startsWith('text:')) {
        const text = symbol.slice(5, 7).toUpperCase();
        ctx.font = `700 ${text.length > 1 ? 11 : 13}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cx, cy + 0.5);
        return;
    }
    ctx.beginPath();
    switch (symbol) {
        case 'infantry':
            ctx.moveTo(x, y);
            ctx.lineTo(x + w, y + h);
            ctx.moveTo(x + w, y);
            ctx.lineTo(x, y + h);
            ctx.stroke();
            break;
        case 'recon':
            ctx.moveTo(x, y + h);
            ctx.lineTo(x + w, y);
            ctx.stroke();
            break;
        case 'sniper':
            ctx.arc(cx, cy, h * 0.32, 0, Math.PI * 2);
            ctx.moveTo(cx, y + 1);
            ctx.lineTo(cx, y + h - 1);
            ctx.moveTo(cx - h * 0.55, cy);
            ctx.lineTo(cx + h * 0.55, cy);
            ctx.stroke();
            break;
        case 'support':
            ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'medic':
            ctx.lineWidth = 3;
            ctx.moveTo(cx, y + 2);
            ctx.lineTo(cx, y + h - 2);
            ctx.moveTo(cx - h * 0.4, cy);
            ctx.lineTo(cx + h * 0.4, cy);
            ctx.stroke();
            break;
        case 'hq':
            ctx.moveTo(x + 3, y + h);
            ctx.lineTo(x + 3, y + 1);
            ctx.lineTo(x + w - 3, y + h * 0.3);
            ctx.lineTo(x + 3, y + h * 0.6);
            ctx.stroke();
            break;
        case 'vehicle':
            ctx.ellipse(cx, cy, w * 0.36, h * 0.3, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
        case 'engineer':
            ctx.moveTo(x + 3, y + h - 2);
            ctx.lineTo(x + 3, y + 3);
            ctx.lineTo(x + w - 3, y + 3);
            ctx.lineTo(x + w - 3, y + h - 2);
            ctx.moveTo(cx, y + 3);
            ctx.lineTo(cx, y + h - 2);
            ctx.stroke();
            break;
        case 'signal':
            ctx.moveTo(x + 2, y + 2);
            ctx.lineTo(cx, y + h - 2);
            ctx.lineTo(cx, y + 2);
            ctx.lineTo(x + w - 2, y + h - 2);
            ctx.stroke();
            break;
        case 'mortar':
            ctx.arc(cx, cy + 2, 3, 0, Math.PI * 2);
            ctx.moveTo(cx, cy - 1);
            ctx.lineTo(cx, y + 1);
            ctx.moveTo(cx - 3, y + 4);
            ctx.lineTo(cx, y + 1);
            ctx.lineTo(cx + 3, y + 4);
            ctx.stroke();
            break;
        case 'star':
            for (let i = 0; i < 10; i++) {
                const r = i % 2 === 0 ? h * 0.48 : h * 0.2;
                const a = (Math.PI / 5) * i - Math.PI / 2;
                ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
            }
            ctx.closePath();
            ctx.fill();
            break;
        case 'skull':
            ctx.arc(cx, cy - 1, h * 0.36, Math.PI, 0);
            ctx.lineTo(cx + h * 0.28, cy + h * 0.42);
            ctx.lineTo(cx - h * 0.28, cy + h * 0.42);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = contrastInk(ink);
            ctx.beginPath();
            ctx.arc(cx - 3, cy - 1, 1.8, 0, Math.PI * 2);
            ctx.arc(cx + 3, cy - 1, 1.8, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'shield':
            ctx.moveTo(cx, y + 1);
            ctx.lineTo(x + w * 0.78, y + 3);
            ctx.lineTo(x + w * 0.74, cy + 2);
            ctx.lineTo(cx, y + h - 1);
            ctx.lineTo(x + w * 0.26, cy + 2);
            ctx.lineTo(x + w * 0.22, y + 3);
            ctx.closePath();
            ctx.stroke();
            break;
        case 'bolt':
            ctx.moveTo(cx + 2, y + 1);
            ctx.lineTo(cx - 4, cy + 1);
            ctx.lineTo(cx, cy + 1);
            ctx.lineTo(cx - 2, y + h - 1);
            ctx.lineTo(cx + 4, cy - 1);
            ctx.lineTo(cx, cy - 1);
            ctx.closePath();
            ctx.fill();
            break;
        case 'crown':
            ctx.moveTo(x + 3, y + h - 2);
            ctx.lineTo(x + 3, y + 3);
            ctx.lineTo(cx - 3, cy);
            ctx.lineTo(cx, y + 2);
            ctx.lineTo(cx + 3, cy);
            ctx.lineTo(x + w - 3, y + 3);
            ctx.lineTo(x + w - 3, y + h - 2);
            ctx.closePath();
            ctx.fill();
            break;
        default:
            ctx.moveTo(x + 3, y + h - 3);
            ctx.lineTo(cx, y + 3);
            ctx.lineTo(x + w - 3, y + h - 3);
            ctx.stroke();
    }
}

function drawMarker(type: string, color: string, symbol: string, status: string, scale: number) {
    const base = type === 'unit' || type === 'enemy' ? 34 : type === 'poi' ? 11 : 30;
    const size = Math.round(base * scale);
    const { c, ctx } = canvas(size + 6);
    ctx.translate(3, 3);
    const s = size;
    const ink = contrastInk(color);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    switch (type) {
        case 'unit': {
            const h = s * 0.68;
            const y = (s - h) / 2;
            ctx.fillStyle = color;
            ctx.strokeStyle = '#14181b';
            ctx.beginPath();
            ctx.roundRect(1, y, s - 2, h, 3);
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.stroke();
            drawUnitGlyph(ctx, symbol || 'infantry', 6, y + 4, s - 12, h - 8, ink);
            break;
        }
        case 'enemy': {
            ctx.fillStyle = color;
            ctx.strokeStyle = '#14181b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(s / 2, 1);
            ctx.lineTo(s - 1, s / 2);
            ctx.lineTo(s / 2, s - 1);
            ctx.lineTo(1, s / 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            drawUnitGlyph(ctx, symbol || 'infantry', s * 0.33, s * 0.33, s * 0.34, s * 0.34, ink);
            break;
        }
        case 'objective': {
            const ring = STATUS_COLORS[status] ?? color;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = status && status !== 'unknown' ? ring : color;
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s * 0.14, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'medic': {
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#14181b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(2, 2, s - 4, s - 4, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = color;
            const b = s * 0.16;
            ctx.fillRect(s / 2 - b / 2 - 1, s * 0.22, b + 2, s * 0.56);
            ctx.fillRect(s * 0.22, s / 2 - b / 2 - 1, s * 0.56, b + 2);
            break;
        }
        case 'respawn': {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = ink;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(s / 2, s / 2, s * 0.24, -Math.PI * 0.2, Math.PI * 1.35);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(s * 0.68, s * 0.24);
            ctx.lineTo(s * 0.76, s * 0.4);
            ctx.lineTo(s * 0.58, s * 0.4);
            ctx.closePath();
            ctx.fillStyle = ink;
            ctx.fill();
            break;
        }
        case 'danger': {
            ctx.fillStyle = color;
            ctx.strokeStyle = '#14181b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(s / 2, 2);
            ctx.lineTo(s - 2, s - 3);
            ctx.lineTo(2, s - 3);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = ink;
            ctx.fillRect(s / 2 - 1.5, s * 0.36, 3, s * 0.3);
            ctx.fillRect(s / 2 - 1.5, s * 0.72, 3, 3);
            break;
        }
        case 'hq':
        case 'flag': {
            ctx.strokeStyle = '#14181b';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(s * 0.28, s - 2);
            ctx.lineTo(s * 0.28, 2);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(s * 0.3, 3);
            ctx.lineTo(s - 3, s * 0.2);
            ctx.lineTo(s * 0.3, s * 0.42);
            ctx.closePath();
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.stroke();
            if (type === 'hq') {
                ctx.fillStyle = '#14181b';
                ctx.beginPath();
                ctx.arc(s * 0.28, s - 3, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            break;
        }
        case 'poi': {
            ctx.fillStyle = color;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(2, 2, s - 4, s - 4, 2);
            ctx.fill();
            ctx.stroke();
            break;
        }
        default: {
            ctx.fillStyle = color;
            ctx.strokeStyle = '#14181b';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const r = s * 0.32;
            ctx.arc(s / 2, r + 2, r, Math.PI, 0);
            ctx.lineTo(s / 2, s - 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = ink;
            ctx.beginPath();
            ctx.arc(s / 2, r + 2, r * 0.38, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    return toImage(c);
}

function drawPattern(kind: string, color: string) {
    const size = 12;
    const { c, ctx } = canvas(size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let o = -size; o <= size * 2; o += 6) {
        ctx.moveTo(o, size);
        ctx.lineTo(o + size, 0);
        if (kind === 'cross') {
            ctx.moveTo(o, 0);
            ctx.lineTo(o + size, size);
        }
    }
    ctx.stroke();
    return toImage(c);
}

function drawArrow(color: string, head: boolean) {
    const size = head ? 18 : 12;
    const { c, ctx } = canvas(size);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    if (head) {
        ctx.moveTo(2, 3);
        ctx.lineTo(size - 2, size / 2);
        ctx.lineTo(2, size - 3);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.moveTo(3, 2);
        ctx.lineTo(size - 4, size / 2);
        ctx.lineTo(3, size - 2);
        ctx.stroke();
    }
    return toImage(c);
}

async function drawLogo(hash: string, scale: number) {
    const asset = await getAsset(hash);
    if (!asset) {
        return null;
    }
    const bitmap = await createImageBitmap(asset.blob);
    const size = Math.round(40 * scale);
    const { c, ctx } = canvas(size);
    const ratio = Math.min(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * ratio;
    const h = bitmap.height * ratio;
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
    bitmap.close();
    return toImage(c);
}

/**
 * Generate icons lazily for any `icon-image` id the plan layers reference. MapLibre 6 waits for
 * the resolver (also for async team logos), so no placeholder or second tile pass is needed.
 */
export function installIconFactory(map: MlMap) {
    map.setMissingStyleImageResolver(async (id) => {
        if (map.hasImage(id)) {
            return;
        }
        const parts = id.split('|');
        try {
            let image: ReturnType<typeof toImage> | null = null;
            if (parts[0] === 'mk') {
                const [, type, color, symbol, status, scale] = parts;
                image = drawMarker(type, color, symbol, status, Number(scale) || 1);
            } else if (parts[0] === 'pat') {
                image = drawPattern(parts[1], parts[2]);
            } else if (parts[0] === 'arrow' || parts[0] === 'head') {
                image = drawArrow(parts[1], parts[0] === 'head');
            } else if (parts[0] === 'logo') {
                image = await drawLogo(parts[1], Number(parts[2]) || 1);
            }
            if (image && !map.hasImage(id)) {
                map.addImage(id, image, { pixelRatio: RATIO });
            }
        } catch (error) {
            console.warn('icon generation failed', id, error);
        }
    });
}

export function markerIconId(type: string, color: string, symbol = '', status = '', scale = 1): string {
    return `mk|${type}|${color}|${symbol}|${status}|${scale.toFixed(2)}`;
}
