// Panels and inspector visual run against `vite preview` on :4000.
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
    const mobile = viewport.width < 800;
    const context = await browser.newContext({ viewport, locale: 'de-CH', hasTouch: mobile, isMobile: mobile });
    await context.addInitScript((mode) => localStorage.setItem('as-tac.appearance', mode), appearance);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`${name}: ${msg.text()}`));
    await page.goto(base);
    await page.getByTestId('new-plan').click();
    await page.getByRole('radio', { name: 'Mission 24' }).click();
    await page.getByTestId('create-plan').click();
    await page.waitForSelector('.maplibregl-canvas');
    await page.waitForTimeout(2200);
    // Select the first HQ via the command palette (works on both form factors).
    await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    await page.waitForTimeout(200);
    await page.keyboard.type('Task Force');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}-inspector.png` });
    await context.close();
}
await run('desktop-dark', { width: 1440, height: 900 }, 'dark');
await run('phone-day', { width: 390, height: 844 }, 'day');
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no page errors');
