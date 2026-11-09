// Field mode (GPS, navigation, path recording) and briefing (phases, pen) against `vite preview` on :4000.
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
const results = {};
const check = (name, ok) => {
    results[name] = ok;
    if (!ok) {
        errors.push(`check failed: ${name}`);
    }
};

async function run(name, viewport) {
    const mobile = viewport.width < 800;
    // Simulated position inside the Mahlwinkel area; no real location is used.
    const context = await browser.newContext({ viewport, locale: 'de-CH', timezoneId: 'Europe/Berlin', hasTouch: mobile, isMobile: mobile, geolocation: { latitude: 52.3832, longitude: 11.8187, accuracy: 8 }, permissions: ['geolocation'] });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`${name}: ${msg.text()}`));
    await page.goto(base);
    await page.getByTestId('new-plan').click();
    await page.getByRole('radio', { name: 'Mission 24' }).click();
    await page.getByTestId('create-plan').click();
    await page.waitForSelector('.maplibregl-canvas');
    await page.waitForTimeout(2000);
    const elementsBefore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__asTacCounts?.() ?? {})).elements ?? -1);

    // Field mode: locate, position readout, navigation to an objective, path recording.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })));
    await page.waitForTimeout(300);
    check(`${name}:field-mode`, (await page.locator('.ws').getAttribute('data-mode')) === 'field');
    await page.getByTestId('locate').click();
    await page.waitForTimeout(1500);
    const coord = await page.locator('.fieldpanel__coord').textContent().catch(() => null);
    check(`${name}:fix-shown`, Boolean(coord && coord.includes('32U')));
    await page.screenshot({ path: `${out}/${name}-field.png` });

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
    await page.waitForTimeout(200);
    await page.keyboard.type('Task Force');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const nav = page.getByTestId('field-navigate');
    if (await nav.count()) {
        await nav.first().click();
        await page.waitForTimeout(600);
        check(`${name}:navcard`, (await page.locator('.navcard').count()) === 1);
        await page.screenshot({ path: `${out}/${name}-field-nav.png` });
    } else {
        check(`${name}:navigate-button`, false);
    }
    // Field mode must not let the plan change.
    const elementsAfter = await page.evaluate(() => window.__asTacCounts?.()?.elements ?? -1);
    check(`${name}:plan-unchanged`, elementsBefore === elementsAfter);

    // Briefing: start from the phases panel (plan mode), add a phase, step, draw, end.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })));
    await page.waitForTimeout(800);
    check(`${name}:briefing-mode`, (await page.locator('.ws').getAttribute('data-mode')) === 'briefing');
    check(`${name}:briefingbar`, (await page.getByTestId('briefingbar').count()) === 1);
    await page.getByRole('button', { name: /Temporär zeichnen/ }).click();
    const box = await page.locator('.maplibregl-canvas').boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 8 });
        await page.mouse.up();
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-briefing.png` });
    await page.getByRole('button', { name: /Briefing beenden/ }).click();
    await page.waitForTimeout(400);
    check(`${name}:briefing-ended`, (await page.locator('.ws').getAttribute('data-mode')) === 'plan');
    await context.close();
}
/** Privacy and compass behaviour on desktop with simulated sensors (no real device). */
async function privacy() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', timezoneId: 'Europe/Berlin', geolocation: { latitude: 52.3832, longitude: 11.8187, accuracy: 8 }, permissions: ['geolocation', 'accelerometer', 'gyroscope', 'magnetometer'] });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`privacy: ${error.message}`));
    await page.goto(base);
    await page.getByTestId('new-plan').click();
    await page.getByRole('radio', { name: 'Mission 24' }).click();
    await page.getByTestId('create-plan').click();
    await page.waitForSelector('.maplibregl-canvas');
    await page.waitForTimeout(1500);
    const camera = () => page.evaluate(() => window.__asTacCamera());
    const near = (c, lng, lat) => Math.abs(c.center[0] - lng) < 0.0005 && Math.abs(c.center[1] - lat) < 0.0005;
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' })));
    await page.getByTestId('locate').click();
    await page.waitForTimeout(1500);
    await context.setGeolocation({ latitude: 52.3850, longitude: 11.8220, accuracy: 8 });
    await page.waitForTimeout(2500);
    check('follow-works', near(await camera(), 11.8220, 52.3850));
    // Streamer Safe: the camera must not follow the device any more.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', shiftKey: true })));
    await page.waitForTimeout(300);
    await context.setGeolocation({ latitude: 52.3870, longitude: 11.8260, accuracy: 8 });
    await page.waitForTimeout(2500);
    check('streamer-no-follow', near(await camera(), 11.8220, 52.3850));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', shiftKey: true })));
    await page.waitForTimeout(800);
    check('streamer-no-locate', near(await camera(), 11.8220, 52.3850));
    check('streamer-gps-hidden', (await page.getByTestId('locate').count()) === 0);
    // Streamer off again; GPS off drops the fix.
    for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', shiftKey: true })));
        await page.waitForTimeout(200);
    }
    await page.getByTestId('gps-off').click();
    await page.waitForTimeout(300);
    check('gps-off-clears', (await page.locator('.fieldpanel__coord').count()) === 0);
    // Compass: simulated absolute orientation (alpha 90 → heading 270).
    await page.evaluate(() => {
        window.__compassTimer = setInterval(() => {
            const event = new Event('deviceorientationabsolute');
            Object.assign(event, { absolute: true, alpha: 90, beta: 0, gamma: 0 });
            window.dispatchEvent(event);
        }, 50);
    });
    const compass = page.getByRole('button', { name: 'Kompass einschalten' });
    if (await compass.count()) {
        await compass.click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Blickrichtung oben' }).click();
        await page.waitForTimeout(1500);
        const bearing = (await camera()).bearing;
        check('heading-up', Math.abs(((bearing - 270 + 540) % 360) - 180) < 3);
        await page.getByRole('button', { name: 'Norden oben' }).first().click();
        await page.waitForTimeout(1200);
        check('north-wins', Math.abs((await camera()).bearing) < 1);
    } else {
        check('compass-button', false);
    }
    await context.close();
}

await privacy();
await run('desktop', { width: 1440, height: 900 });
await run('phone', { width: 390, height: 844 });
await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
