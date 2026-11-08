// Live collaboration over a simulated weak mobile link (test mode): slow, high latency, and a
// share of requests and realtime messages lost. Nothing may get lost or duplicated.
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
const check = (name, ok, detail = '') => {
    results[name] = ok;
    if (!ok) {
        errors.push(`check failed: ${name} ${detail}`);
    }
};
// About EDGE/poor 3G: 300 ms latency, 64 kbit/s, every 5th request and realtime message lost.
const WEAK = { latencyMs: 300, kbps: 64, failRate: 0.2 };
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH' });
const watch = (page, name) => {
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
};
const counts = (page) => page.evaluate(() => window.__asTacCounts());
const net = (page, sim) => page.evaluate((value) => {
    window.__asTacNet = value;
}, sim);
const stats = (page) => page.evaluate(() => window.__asTacNetStats ?? { up: 0, down: 0, requests: 0 });
const panel = async (page, name) => {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
    await page.waitForFunction(() => document.activeElement?.closest('.palette'));
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
};
const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
/** Wait until the live status says everything is sent (or time runs out). */
const synced = (page, ms = 120000) => page.waitForFunction(() => /Synchron|ohne Echtzeit/.test(document.querySelector('[data-testid="live-status"]')?.textContent ?? ''), null, { timeout: ms }).then(() => true, () => false);

// Owner: a plan from the Mahlwinkel template (about 90 objects), published over the weak link.
const owner = await context.newPage();
watch(owner, 'owner');
await owner.goto(base);
await owner.getByTestId('new-plan').click();
await owner.locator('.dialog .chip[role="radio"]').nth(1).click();
await owner.getByTestId('create-plan').click();
await owner.waitForSelector('.maplibregl-canvas');
await settle(1500);
const planObjects = (await counts(owner)).elements;
check('template-loaded', planObjects > 50, String(planObjects));
await net(owner, WEAK);
await panel(owner, 'Live');
await owner.getByTestId('go-live').click();
await owner.getByTestId('live-panel').waitFor();
check('owner-published', await synced(owner));
const published = await stats(owner);
console.log('owner publish traffic', JSON.stringify(published));
await owner.getByTestId('create-invite').click();
const adminCode = (await owner.getByRole('button', { name: 'Als Admin' }).count())
    ? await (async () => {
        await owner.getByRole('button', { name: 'Als Admin' }).click();
        await owner.getByTestId('create-invite').click();
        return (await owner.getByTestId('invite-code').textContent()).replace(/\s/g, '');
    })()
    : null;
check('admin-code', Boolean(adminCode));

// Admin joins over the same weak link: the plan arrives in pages, with progress shown.
const admin = await context.newPage();
watch(admin, 'admin');
await admin.addInitScript((sim) => {
    window.__asTacNet = sim;
}, WEAK);
await admin.goto(`${base}/#join=${adminCode}`);
await admin.getByTestId('join-code').waitFor();
await admin.getByTestId('join-submit').click();
const sawProgress = await admin.getByTestId('join-progress').waitFor({ timeout: 20000 }).then(() => true, () => false);
await admin.waitForSelector('.maplibregl-canvas', { timeout: 180000 });
await settle(1500);
check('join-progress-shown', sawProgress);
check('admin-has-whole-plan', (await counts(admin)).elements === planObjects, `${(await counts(admin)).elements} vs ${planObjects}`);
console.log('admin join traffic', JSON.stringify(await stats(admin)));

// Admin loses the network entirely, keeps working, then gets a weak link back.
await net(admin, { ...WEAK, failRate: 1 });
await admin.keyboard.press('Escape');
const box = await admin.locator('.maplibregl-canvas').boundingBox();
for (let i = 0; i < 4; i++) {
    await admin.keyboard.press('m');
    await admin.mouse.click(box.x + box.width * (0.3 + i * 0.1), box.y + box.height * 0.3);
    await settle(300);
}
await settle(2500);
// (A click can land on a template object and select it instead: count what was really created.)
const created = (await counts(admin)).elements - planObjects;
check('admin-kept-working', created >= 3, String(created));
await panel(admin, 'Live');
const waiting = await admin.locator('[data-testid="live-status"]').textContent();
check('admin-shows-waiting', /warten|Sende|Offline/.test(waiting ?? ''), waiting ?? '');
await net(admin, WEAK);
await admin.evaluate(() => window.dispatchEvent(new Event('online')));
check('admin-sent-after-dropout', await synced(admin, 180000));

// The owner gets every one of them exactly once (realtime messages may have been lost on the way).
await owner.evaluate(() => window.dispatchEvent(new Event('online')));
await owner.waitForFunction((n) => window.__asTacCounts().elements === n, planObjects + created, { timeout: 120000 }).catch(() => undefined);
check('owner-received-all', (await counts(owner)).elements === planObjects + created, `${(await counts(owner)).elements} vs ${planObjects + created}`);
await settle(3000);
check('no-duplicates', (await counts(owner)).elements === planObjects + created && (await counts(admin)).elements === planObjects + created);
check('no-false-conflicts', (await owner.locator('.conflict').count()) === 0 && (await admin.locator('.conflict').count()) === 0);
await admin.screenshot({ path: `${out}/live-weak-admin.png` });
console.log('admin total traffic', JSON.stringify(await stats(admin)));

await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
