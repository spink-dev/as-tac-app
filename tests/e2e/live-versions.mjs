// Live partners on different app versions (test mode): one tab pretends to be a newer app. The
// older device must not apply what it can't read, must hold its own changes instead of writing next
// to a newer format, and must ask for an update; a new member is told to update before joining.
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
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH' });
const watch = (page, name) => {
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
};
const counts = (page) => page.evaluate(() => window.__asTacCounts());
const panel = async (page, name) => {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
    await page.waitForFunction(() => document.activeElement?.closest('.palette'));
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
};
const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms));
const mark = async (page, fx, fy = 0.5) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    const box = await page.locator('.maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await settle();
};

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
await owner.getByRole('button', { name: 'Als Admin' }).click();
await owner.getByTestId('create-invite').click();
const laterCode = (await owner.getByTestId('invite-code').textContent()).replace(/\s/g, '');

const newer = await context.newPage();
watch(newer, 'newer');
await newer.goto(`${base}/#join=${adminCode}`);
await newer.getByTestId('join-code').waitFor();
await newer.getByTestId('join-submit').click();
await newer.waitForSelector('.maplibregl-canvas');
await settle(1200);

// Same version on both sides: a marker arrives as usual.
await mark(owner, 0.3);
const same = await newer.waitForFunction(() => window.__asTacCounts().elements === 1, null, { timeout: 20000 }).then(() => true, () => false);
check('same-version-syncs', same);

// The partner now writes a newer plan format.
// (One format ahead: a real next version. Tags implausibly far ahead count as broken instead.)
const NEXT_FORMAT = 2;
await newer.evaluate((format) => {
    window.__asTacWireFormat = format;
}, NEXT_FORMAT);
await mark(newer, 0.5);
const asked = await owner.locator('.live-badge').filter({ hasText: /Update nötig/ }).waitFor({ timeout: 30000 }).then(() => true, () => false);
check('older-device-asks-for-update', asked);
check('badge-says-update', /Update nötig/.test(await owner.locator('.live-badge').textContent().catch(() => '')));
check('newer-object-not-applied', (await counts(owner)).elements === 1, String((await counts(owner)).elements));
await owner.screenshot({ path: `${out}/live-versions-owner.png` });

// The older device keeps working, but holds its changes until it is updated.
// (Left half: the details panel of the selected marker covers the right side.)
await mark(owner, 0.42, 0.3);
check('own-edit-kept-locally', (await counts(owner)).elements === 2);
await settle(4000);
check('own-edit-held-back', (await counts(newer)).elements === 2, `${(await counts(newer)).elements} on the newer device`);
await panel(owner, 'Live');
const status = await owner.getByTestId('live-status').textContent();
check('queued-shown', /1/.test(status ?? ''), status ?? '');
check('panel-asks-for-update', await owner.getByTestId('live-outdated').isVisible());

// Someone joining now is told to update first instead of getting a plan with holes.
const late = await context.newPage();
watch(late, 'late');
await late.goto(`${base}/#join=${laterCode}`);
await late.getByTestId('join-code').waitFor();
await late.getByTestId('join-submit').click();
const refused = await late.getByText(/neueren AS-TAC-Version bearbeitet/).waitFor({ timeout: 30000 }).then(() => true, () => false);
check('join-refused-with-reason', refused);

// "Update": the owner's app now reads that format — simulated by retagging the newer object on the
// test server as the current format, then reloading into the same plan as an update does.
await owner.evaluate((format) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('as-tac-loopback:plan:'));
    const state = JSON.parse(localStorage.getItem(key));
    for (const entity of Object.values(state.entities)) {
        if (entity.data && entity.data._fv === format) {
            entity.data._fv = 1;
        }
    }
    localStorage.setItem(key, JSON.stringify(state));
}, NEXT_FORMAT);
await newer.evaluate(() => {
    delete window.__asTacWireFormat;
});
const projectId = await owner.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('as-tac-v2');
    request.onsuccess = () => {
        request.result.transaction('liveLinks').objectStore('liveLinks').getAll().onsuccess = (event) => {
            const owned = event.target.result.find((link) => link.role === 'owner');
            resolve(owned?.projectId ?? null);
            request.result.close();
        };
    };
}));
await owner.evaluate((id) => sessionStorage.setItem('as-tac.resume', JSON.stringify({ projectId: id, mode: 'plan', streamer: 'off', at: Date.now() })), projectId);
await owner.reload();
await owner.waitForSelector('.maplibregl-canvas', { timeout: 60000 });
const fetched = await owner.waitForFunction(() => window.__asTacCounts().elements === 3, null, { timeout: 30000 }).then(() => true, () => false);
check('after-update-held-object-arrives', fetched, String((await counts(owner)).elements));
const sent = await newer.waitForFunction(() => window.__asTacCounts().elements === 3, null, { timeout: 30000 }).then(() => true, () => false);
check('after-update-held-edit-goes-out', sent, String((await counts(newer)).elements));
check('after-update-no-longer-outdated', !(await owner.locator('.live-badge').filter({ hasText: /Update nötig/ }).count()));

await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
