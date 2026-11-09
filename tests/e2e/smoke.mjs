// Visual smoke run against `vite preview` (port 4000). Usage: node tests/e2e/smoke.mjs <outdir>
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
const errors = [];
async function run(name, viewport, appearance) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 800, isMobile: viewport.width < 800, timezoneId: 'Europe/Berlin' });
    await context.addInitScript((mode) => localStorage.setItem('as-tac.appearance', mode), appearance);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            errors.push(`${name} console: ${msg.text()}`);
        }
    });
    await page.goto(base);
    await page.getByTestId('new-plan').click();
    await page.getByRole('radio', { name: 'Dark Emergency' }).click();
    await page.getByTestId('create-plan').click();
    await page.waitForSelector('.maplibregl-canvas');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${name}-workspace.png` });
    await page.getByTestId('back').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-library.png` });
    await context.close();
}
await run('desktop-day', { width: 1440, height: 900 }, 'day');
await run('desktop-dark', { width: 1440, height: 900 }, 'dark');
await run('phone-red', { width: 390, height: 844 }, 'red');
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no page errors');
