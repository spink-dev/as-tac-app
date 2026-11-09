import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../src/core/model/factory';
import type { ImageOverlay, Zone } from '../../src/core/model/schema';
import { useProject } from '../../src/core/store/project';
import { fitFromControlPoints, setImagePlacement, transformCorners, validCorners } from '../../src/core/images';
import { placeImage } from '../../src/core/geo/affine';
import { imageDimensions } from '../../src/core/storage/assets';

const CENTER: [number, number] = [8.5402, 47.3782];

function image(): ImageOverlay {
    return { id: 'img', name: 'Scan', asset: 'a'.repeat(64), mime: 'image/png', width: 1000, height: 800, corners: placeImage(CENTER, 1000, 800, 1), opacity: 0.8, visible: true, fit: { method: 'manual' } };
}

describe('image placement', () => {
    beforeEach(() => {
        const project = createProject({ name: 'Img', areaId: null });
        const zone: Zone = { kind: 'zone', id: 'z', shape: { type: 'circle', center: CENTER, radiusM: 100 }, category: 'ao', fillOpacity: 0.2, anchorImageId: 'img' };
        useProject.getState().load({ ...project, images: [image()], elements: [zone] });
    });

    it('keeps a bound circle radius when the image only rotates', () => {
        const start = useProject.getState().project!.images[0].corners;
        // Rotate 60° about the centre by dragging the TL corner around it at the same distance.
        const [cx, cy] = CENTER;
        const [x, y] = [start[0][0] - cx, start[0][1] - cy];
        const k = Math.cos((47.3782 * Math.PI) / 180);
        const angle = Math.PI / 3;
        const ex = x * k;
        const to: [number, number] = [cx + (ex * Math.cos(angle) - y * Math.sin(angle)) / k, cy + ex * Math.sin(angle) + y * Math.cos(angle)];
        const rotated = transformCorners(start, { kind: 'corner', index: 0, to });
        expect(setImagePlacement('img', rotated, {}, true, 'rot')).toBe(true);
        const zone = useProject.getState().project!.elements[0] as Zone;
        expect(zone.shape.type === 'circle' && zone.shape.radiusM).toBeCloseTo(100, 0);
    });

    it('refuses corners outside the world', () => {
        const bad = image().corners.map((c) => [c[0] + 400, c[1]]) as ImageOverlay['corners'];
        expect(validCorners(bad)).toBe(false);
        expect(validCorners(image().corners)).toBe(true);
    });
});

describe('control point fits', () => {
    const img = image();
    const geo = (px: [number, number]): [number, number] => [CENTER[0] + (px[0] - 500) * 1.3e-5, CENTER[1] - (px[1] - 400) * 9e-6];

    it('claims no accuracy for an exact two-pair fit', () => {
        const fit = fitFromControlPoints(img, [{ px: [100, 100], lngLat: geo([100, 100]) }, { px: [900, 700], lngLat: geo([900, 700]) }]);
        expect(fit?.fit.method).toBe('similarity');
        expect(fit?.fit.rmsM).toBeUndefined();
    });

    it('uses similarity for three pairs and reports a residual', () => {
        const fit = fitFromControlPoints(img, [
            { px: [100, 100], lngLat: geo([100, 100]) },
            { px: [900, 700], lngLat: geo([900, 700]) },
            { px: [100, 700], lngLat: geo([100, 700]) },
        ]);
        expect(fit?.fit.method).toBe('similarity');
        expect(fit?.fit.rmsM).toBeTypeOf('number');
    });

    it('rejects nearly coincident image points paired with distant map points', () => {
        const fit = fitFromControlPoints(img, [
            { px: [500, 400], lngLat: CENTER },
            { px: [500.1, 400], lngLat: [CENTER[0] + 0.02, CENTER[1]] },
        ]);
        expect(fit).toBeNull();
    });
});

describe('image header sniffing', () => {
    it('reads PNG and GIF dimensions without decoding', () => {
        const png = new Uint8Array(24);
        png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        png.set([0, 0, 0x10, 0, 0, 0, 0x08, 0], 16);
        expect(imageDimensions(png)).toEqual({ width: 4096, height: 2048 });
        const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
        expect(imageDimensions(gif)).toEqual({ width: 320, height: 240 });
    });

    it('reads a JPEG frame header and rejects unknown data', () => {
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x05, 0x00, 0x03]);
        expect(imageDimensions(jpeg)).toEqual({ width: 1280, height: 800 });
        expect(imageDimensions(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    });
});
