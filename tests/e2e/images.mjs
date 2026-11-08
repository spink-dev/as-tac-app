// Image map run against `vite preview` on :4000.
// Usage: node tests/e2e/images.mjs <outdir> <known-event-image?> <any-image>
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try {
    playwright = require('playwright');
} catch {
    playwright = require('/opt/npm-tools/node_modules/playwright');
}
const [out = 'tests/e2e/screenshots', known, given] = process.argv.slice(2);

/** A checkerboard PNG, so the scenario always has an image to place and align. */
function makePng(size) {
    const { deflateSync, crc32 } = require('node:zlib');
    const chunk = (type, data) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body) >>> 0);
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 2;
    const rows = [];
    for (let y = 0; y < size; y++) {
        const row = Buffer.alloc(1 + size * 3);
        for (let x = 0; x < size; x++) {
            const on = ((x >> 4) + (y >> 4)) % 2 === 0;
            row.set(on ? [200, 120, 40] : [240, 240, 230], 1 + x * 3);
        }
        rows.push(row);
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const scratch = mkdtempSync(join(tmpdir(), 'astac-images-'));
const sketch = given ?? join(scratch, 'skizze.png');
if (!given) {
    writeFileSync(sketch, makePng(256));
}
const fake = join(scratch, 'kein-bild.png');
writeFileSync(fake, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const base = process.env.BASE_URL ?? 'http://localhost:4000';
const browser = await playwright.chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-CH' });
await context.addInitScript(() => localStorage.setItem('as-tac.appearance', 'day'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
const fail = (message) => {
    console.log('FAIL', message);
    process.exitCode = 1;
};
await page.goto(base);
await page.getByTestId('new-plan').click();
await page.locator('input.input').first().fill('Bildkarten');
await page.getByTestId('create-plan').click();
await page.waitForSelector('.maplibregl-canvas');
await page.waitForTimeout(1500);
const addImage = async (file) => {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
    await page.keyboard.type('Karten');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Bildkarte hinzufügen/ }).click();
    await (await chooser).setFiles(file);
    await page.waitForTimeout(1500);
};
if (!known) {
    // Third-party event maps are never bundled: recognition is only checked with your own copy.
    console.log('skipped: known event image (pass its path as the second argument)');
}
if (known && existsSync(known)) {
    await addImage(known);
    const toastText = await page.locator('.toast').first().textContent().catch(() => '');
    console.log('known image toast:', toastText);
    if (!/erkannt|recognised/.test(toastText ?? '')) {
        fail('known event image was not recognised');
    }
    await page.screenshot({ path: `${out}/images-known.png` });
}
if (sketch && existsSync(sketch)) {
    await addImage(sketch);
    await page.waitForSelector('[data-testid="alignbar"]');
    const map = await page.getByTestId('map').boundingBox();
    const tap = async (fx, fy) => {
        await page.mouse.click(map.x + map.width * fx, map.y + map.height * fy);
        await page.waitForTimeout(250);
    };
    // Two pairs: image point, then where it really is.
    await tap(0.45, 0.45);
    await tap(0.4, 0.4);
    await tap(0.6, 0.6);
    await tap(0.62, 0.58);
    const pairs = await page.locator('[data-testid="alignbar"] .badge').first().textContent();
    console.log('align pairs:', pairs);
    if (!/2/.test(pairs ?? '')) {
        fail(`expected 2 control points, got ${pairs}`);
    }
    await page.screenshot({ path: `${out}/images-align.png` });
    await page.getByTestId('align-done').click();
    await page.waitForTimeout(500);
    const thumbs = await page.locator('.image-row img.thumb').count();
    console.log('thumbnails shown:', thumbs);
    if (thumbs < 1) {
        fail('image map thumbnail not shown');
    }
}
// Something that only claims to be a PNG is refused with an explanation, never stored as a map.
const before = await page.locator('.image-row').count();
const refusal = page.locator('.toast', { hasText: /kann nicht gelesen|can’t be read/ });
const earlier = await refusal.count();
await addImage(fake);
const refused = (await refusal.count()) > earlier;
console.log('fake image refused:', refused);
if (!refused || (await page.locator('.image-row').count()) !== before) {
    fail('fake image was not refused clearly');
}
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
