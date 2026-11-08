// Tool interaction run against `vite preview` on :4000. Usage: node tests/e2e/tools.mjs <outdir>
import { createRequire } from 'node:module';
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
await page.locator('input.input').first().fill('Werkzeugtest');
await page.getByTestId('create-plan').click();
await page.waitForSelector('.maplibregl-canvas');
await page.waitForTimeout(1500);
const map = page.getByTestId('map');
const box = await map.boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
const click = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
};
const count = () => page.evaluate(async () => (await import('/src/core/store/project.ts').catch(() => null)) ? -1 : -1);
void count;
// Marker
await page.keyboard.press('m');
await page.keyboard.press('1');
await click(0.35, 0.4);
// Route
await page.keyboard.press('r');
await click(0.4, 0.55);
await click(0.5, 0.5);
await click(0.6, 0.6);
await page.keyboard.press('Enter');
// Polygon zone
await page.keyboard.press('z');
await page.keyboard.press('2');
await click(0.62, 0.25);
await click(0.72, 0.25);
await click(0.72, 0.38);
await click(0.62, 0.25);
// Circle zone
await page.keyboard.press('z');
await page.keyboard.press('Tab');
await click(0.25, 0.7);
await click(0.29, 0.7);
// Draw
await page.keyboard.press('d');
const s = at(0.45, 0.75);
await page.mouse.move(s.x, s.y);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
    await page.mouse.move(s.x + i * 12, s.y + Math.sin(i / 2) * 20);
}
await page.mouse.up();
await page.keyboard.press('v');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/tools-plan.png` });
const saved = await page.locator('.topbar__save').textContent();
// Undo / redo of the stroke
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(600);
const counts = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('as-tac-v2');
    request.onsuccess = () => {
        const tx = request.result.transaction('projects', 'readonly');
        const all = tx.objectStore('projects').getAll();
        all.onsuccess = () => {
            const project = all.result.find((row) => row.data.name === 'Werkzeugtest').data;
            resolve({ elements: project.elements.map((e) => `${e.kind}:${e.type ?? e.style ?? e.shape?.type ?? ''}`), drawings: project.drawings.length });
        };
    };
}));
console.log('saved state:', saved, JSON.stringify(counts));
const kinds = counts.elements.join(',');
if (!kinds.includes('marker:unit') || !kinds.includes('route:planned') || !kinds.includes('zone:polygon') || !kinds.includes('zone:circle')) {
    fail(`expected marker, route, polygon and circle, got ${kinds}`);
}
if (counts.drawings !== 1) {
    fail(`expected 1 drawing after undo/redo, got ${counts.drawings}`);
}
// Select the route by clicking it and drag a vertex handle
await click(0.45, 0.525);
await page.waitForTimeout(300);
const handle = at(0.5, 0.5);
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
await page.mouse.move(handle.x + 20, handle.y - 40, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/tools-edit.png` });
// The first click after a drag must not be swallowed: clicking empty map clears the selection.
await click(0.15, 0.2);
await page.waitForTimeout(250);
const handlesLeft = await page.evaluate(() => document.querySelectorAll('[data-testid="inspector"]').length);
void handlesLeft;
const selectionAfter = await page.evaluate(() => window.__asTacSelection?.() ?? null);
if (selectionAfter && selectionAfter.length !== 0) {
    fail(`click after drag was swallowed; selection still ${selectionAfter}`);
}
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
