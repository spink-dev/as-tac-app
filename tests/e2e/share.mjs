// Share & import: .astac round trip, QR/plan link, TacMap import with placement. Against `vite preview` on :4000.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try {
    playwright = require('playwright');
} catch {
    playwright = require('/opt/npm-tools/node_modules/playwright');
}
const { zipSync, strToU8 } = require('fflate');
const out = process.argv[2] ?? 'tests/e2e/screenshots';
const base = process.env.BASE_URL ?? 'http://localhost:4000';
const dir = mkdtempSync(join(tmpdir(), 'astac-e2e-'));
const browser = await playwright.chromium.launch();
const errors = [];
const results = {};
const check = (name, ok) => {
    results[name] = ok;
    if (!ok) {
        errors.push(`check failed: ${name}`);
    }
};

const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
await page.goto(base);
await page.getByTestId('new-plan').click();
await page.getByRole('radio', { name: 'Mission 24' }).click();
await page.getByTestId('create-plan').click();
await page.waitForSelector('.maplibregl-canvas');
await page.waitForTimeout(1500);
const elements = await page.evaluate(() => window.__asTacCounts().elements);

// Export .astac.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
await page.keyboard.type('Teilen');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('share-download').click()]);
const astacPath = join(dir, download.suggestedFilename());
await download.saveAs(astacPath);
check('export-name', download.suggestedFilename().endsWith('.astac'));

// QR for this plan is too large (bundled template) → message; that is expected for event templates.
await page.getByTestId('share-qr').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/share-panel.png` });

// Import the file again from the library.
await page.getByRole('button', { name: 'Zurück' }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /Importieren|Datei öffnen/ }).first().click();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-pick').click()]);
await chooser.setFiles(astacPath);
await page.getByTestId('import-summary').waitFor({ timeout: 15000 });
await page.screenshot({ path: `${out}/import-summary.png` });
await page.getByTestId('import-open').click();
await page.waitForSelector('.maplibregl-canvas');
await page.waitForTimeout(800);
check('roundtrip-elements', (await page.evaluate(() => window.__asTacCounts().elements)) === elements);

// Small plan → link → open in a fresh page.
await page.getByRole('button', { name: 'Zurück' }).first().click();
await page.getByTestId('new-plan').click();
await page.getByTestId('create-plan').click();
await page.waitForSelector('.maplibregl-canvas');
await page.waitForTimeout(1200);
await page.keyboard.press('m');
const box = await page.locator('.maplibregl-canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
await page.waitForTimeout(300);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
await page.keyboard.type('Teilen');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.getByTestId('share-qr').click();
await page.waitForSelector('.qr svg');
await page.getByRole('button', { name: 'Link kopieren' }).click();
await page.waitForTimeout(300);
const link = await page.evaluate(() => navigator.clipboard.readText());
check('link-shape', link.includes('#plan='));
const fresh = await context.newPage();
fresh.on('pageerror', (error) => errors.push(`fresh: ${error.message}`));
await fresh.goto(link);
await fresh.getByTestId('import-summary').waitFor({ timeout: 10000 });
check('link-hash-cleared', !fresh.url().includes('#plan='));
await fresh.getByTestId('import-open').click();
await fresh.waitForSelector('.maplibregl-canvas');
check('link-elements', (await fresh.evaluate(() => window.__asTacCounts().elements)) === 1);
await fresh.close();

// TacMap with an uncalibrated map → placement step → alignment opens.
// A valid 64×64 PNG (checkerboard) built here, so MapLibre can decode it.
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
            const on = ((x >> 3) + (y >> 3)) % 2 === 0;
            row.set(on ? [200, 120, 40] : [240, 240, 230], 1 + x * 3);
        }
        rows.push(row);
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const png = makePng(64);
const hash = createHash('sha256').update(png).digest('hex');
const tacProject = {
    id: 'tp', formatVersion: 1, name: 'TacMap Feld', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', activeMapId: 'm',
    teams: [], phases: [], eventLog: [], tracks: [], settings: { gridEnabled: false },
    maps: [{ id: 'm', name: 'Skizze', image: hash, width: 64, height: 64, overlays: [], calibration: { kind: 'scale', pxPerMeter: 0.2 }, elements: [{ kind: 'marker', id: 'x', pos: { x: 32, y: 32 }, symbol: 'objective' }] }],
};
const json = JSON.stringify(tacProject);
const manifest = { format: 'tacmap', formatVersion: 1, appVersion: '0.12.0', createdWith: 'TacMap 0.12.0', checksum: createHash('sha256').update(json).digest('hex'), assets: [{ hash, mime: 'image/png', size: png.length }] };
const tacPath = join(dir, 'feld.tacmap');
writeFileSync(tacPath, zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'project.json': strToU8(json), [`assets/${hash}.png`]: new Uint8Array(png) }));
await page.getByRole('button', { name: 'Zurück' }).first().click();
await page.getByRole('button', { name: /Importieren|Datei öffnen/ }).first().click();
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('import-pick').click()]);
await chooser2.setFiles(tacPath);
await page.getByRole('button', { name: 'Weiter' }).click({ timeout: 10000 });
await page.getByTestId('import-summary').waitFor({ timeout: 10000 });
await page.getByTestId('import-open').click();
await page.waitForSelector('.maplibregl-canvas');
await page.waitForTimeout(1500);
check('tacmap-align-open', (await page.getByTestId('alignbar').count()) === 1);
await page.screenshot({ path: `${out}/tacmap-import.png` });

await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
