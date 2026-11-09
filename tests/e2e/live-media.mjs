// Image maps in live mode over a weak link (test mode): the owner's upload runs in the background,
// and a device with the data saver on ("Manuell") only downloads the picture when asked.
import { createRequire } from 'node:module';
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
const out = process.argv[2] ?? 'tests/e2e/screenshots';
const base = process.env.BASE_URL ?? 'http://localhost:4000';
const browser = await playwright.chromium.launch();
const errors = [];
const results = {};
const check = (name, ok, detail = '') => {
    results[name] = ok;
    if (!ok) {
        errors.push(`check failed: ${name} ${detail}`);
    }
};
const WEAK = { latencyMs: 300, kbps: 256, failRate: 0.15 };

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
            // Noise-ish pattern so the PNG doesn't compress to nothing (a realistic few 100 KB).
            row.set([(x * 7 + y * 13) & 255, (x * y) & 255, ((x ^ y) * 5) & 255], 1 + x * 3);
        }
        rows.push(row);
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const dir = mkdtempSync(join(tmpdir(), 'astac-media-'));
const pngPath = join(dir, 'lageplan.png');
const png = makePng(400);
writeFileSync(pngPath, png);

const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH' });
const watch = (page, name) => {
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
};
const panel = async (page, name) => {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
    await page.waitForFunction(() => document.activeElement?.closest('.palette'));
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
};
const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
const localPictures = (page) => page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('as-tac-v2');
    request.onsuccess = () => {
        const tx = request.result.transaction('assets').objectStore('assets').count();
        tx.onsuccess = () => {
            resolve(tx.result);
            request.result.close();
        };
    };
}));
const serverPictures = (page) => page.evaluate(async () => (await (await caches.open('as-tac-loopback:assets')).keys()).length);

// Owner: live plan, then an image map over a weak link (the upload must not hold up edits).
const owner = await context.newPage();
watch(owner, 'owner');
await owner.goto(base);
await owner.getByTestId('new-plan').click();
await owner.getByTestId('create-plan').click();
await owner.waitForSelector('.maplibregl-canvas');
await settle(1200);
await panel(owner, 'Live');
await owner.getByTestId('go-live').click();
await owner.getByTestId('live-panel').waitFor();
await owner.getByRole('button', { name: 'Als Admin' }).click();
await owner.getByTestId('create-invite').click();
const adminCode = (await owner.getByTestId('invite-code').textContent()).replace(/\s/g, '');
await owner.evaluate((sim) => {
    window.__asTacNet = sim;
}, WEAK);
await panel(owner, 'Karten');
const chooser = owner.waitForEvent('filechooser');
await owner.getByRole('button', { name: /Bildkarte hinzufügen/ }).click();
await (await chooser).setFiles(pngPath);
await owner.getByTestId('alignbar').waitFor();
await owner.getByTestId('align-done').click();
await settle(500);
// A plain edit right after: it must reach the server while the picture is still uploading.
await owner.keyboard.press('Escape');
await owner.keyboard.press('m');
const box = await owner.locator('.maplibregl-canvas').boundingBox();
await owner.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.8);
const markerSent = await owner.waitForFunction(() => {
    const raw = Object.keys(localStorage).find((key) => key.startsWith('as-tac-loopback:plan:'));
    const state = raw ? JSON.parse(localStorage.getItem(raw)) : null;
    return state && Object.values(state.entities).some((e) => e.collection === 'elements' && e.data);
}, null, { timeout: 60000 }).then(() => true, () => false);
const uploadedWhenMarkerArrived = await serverPictures(owner);
check('edit-not-blocked-by-upload', markerSent, `server pictures at that time: ${uploadedWhenMarkerArrived}`);
let uploaded = false;
for (let i = 0; i < 180 && !uploaded; i++) {
    uploaded = (await serverPictures(owner)) > 0;
    if (!uploaded) {
        await settle(1000);
    }
}
check('picture-uploaded', uploaded);

// Admin joins with the data saver on: the picture is listed, not downloaded.
const admin = await context.newPage();
watch(admin, 'admin');
await admin.addInitScript((sim) => {
    window.__asTacNet = sim;
    const prefs = JSON.parse(localStorage.getItem('as-tac.prefs') ?? '{}');
    localStorage.setItem('as-tac.prefs', JSON.stringify({ ...prefs, mediaDownload: 'manual' }));
}, WEAK);
// A fresh device has no pictures: clear the (shared, test-mode) local store first, and close the
// owner's tab — in test mode all tabs share one store, and the owner would fetch it back.
const helper = await context.newPage();
await helper.goto(`${base}/licenses/OFL-1.1.txt`);
await owner.close();
await helper.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('as-tac-v2');
    request.onsuccess = () => {
        const tx = request.result.transaction('assets', 'readwrite');
        tx.objectStore('assets').clear();
        tx.oncomplete = () => {
            request.result.close();
            resolve(true);
        };
    };
}));
await helper.close();
await admin.goto(`${base}/#join=${adminCode}`);
await admin.getByTestId('join-code').waitFor();
await admin.getByTestId('join-submit').click();
await admin.waitForSelector('.maplibregl-canvas', { timeout: 120000 });
await settle(4000);
check('saver-held-back', (await localPictures(admin)) === 0);
await panel(admin, 'Live');
const listed = await admin.getByTestId('load-pictures').waitFor({ timeout: 30000 }).then(() => true, () => false);
check('missing-listed', listed);
console.log('admin traffic before loading', JSON.stringify(await admin.evaluate(() => window.__asTacNetStats)));

// The admin asks for it: it arrives over the weak link, with progress.
await admin.getByTestId('load-pictures').click();
const sawProgress = await admin.getByText(/Bild wird geladen/).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
const arrived = await admin.waitForFunction(() => !document.querySelector('[data-testid="load-pictures"]'), null, { timeout: 180000 }).then(() => true, () => false);
check('progress-shown', sawProgress);
check('picture-arrived', arrived && (await localPictures(admin)) === 1);
await panel(admin, 'Karten');
check('map-thumb-shown', (await admin.locator('.image-row img.thumb').count()) === 1);
await admin.screenshot({ path: `${out}/live-media-admin.png` });
console.log('admin traffic total', JSON.stringify(await admin.evaluate(() => window.__asTacNetStats)), 'picture', png.length, 'bytes');

await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
