// Live collaboration in local test mode: two/three tabs = different users. Against `vite preview` on :4000.
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
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH' });
const watch = (page, name) => {
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`${name}: ${msg.text()}`));
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

// Owner: new blank plan, go live, invite a viewer and an admin.
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
await owner.getByTestId('create-invite').click();
const viewerCode = (await owner.getByTestId('invite-code').textContent()).replace(/\s/g, '');
await owner.getByRole('button', { name: 'Als Admin' }).click();
await owner.getByTestId('create-invite').click();
const adminCode = (await owner.getByTestId('invite-code').textContent()).replace(/\s/g, '');
check('codes', /^[A-Z2-9]{8}$/.test(viewerCode) && /^[A-Z2-9]{8}$/.test(adminCode) && viewerCode !== adminCode);

async function join(name, code) {
    const page = await context.newPage();
    watch(page, name);
    await page.goto(`${base}/#join=${code}`);
    await page.getByTestId('join-code').waitFor();
    await page.getByTestId('join-submit').click();
    await page.waitForSelector('.maplibregl-canvas');
    await settle(1200);
    return page;
}
const viewer = await join('viewer', viewerCode);
const admin = await join('admin', adminCode);

// Owner adds a marker → both see it.
await owner.keyboard.press('Escape');
await owner.keyboard.press('m');
const box = await owner.locator('.maplibregl-canvas').boundingBox();
await owner.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.5);
await settle();
const ownerCount = (await counts(owner)).elements;
check('owner-marker', ownerCount === 1);
check('viewer-sees', (await counts(viewer)).elements === ownerCount);
check('admin-sees', (await counts(admin)).elements === ownerCount);

// Admin adds one too → owner and viewer see it.
await admin.keyboard.press('m');
const box2 = await admin.locator('.maplibregl-canvas').boundingBox();
await admin.mouse.click(box2.x + box2.width * 0.6, box2.y + box2.height * 0.45);
await settle();
check('owner-sees-admin', (await counts(owner)).elements === 2);
check('viewer-sees-admin', (await counts(viewer)).elements === 2);

// Viewer cannot create.
await viewer.keyboard.press('m');
await settle(300);
check('viewer-told', (await viewer.locator('.toast', { hasText: 'Zuschauer' }).count()) >= 1);
const box3 = await viewer.locator('.maplibregl-canvas').boundingBox();
await viewer.mouse.click(box3.x + box3.width * 0.5, box3.y + box3.height * 0.6);
await settle();
const vc = await counts(viewer);
const oc = await counts(owner);
check('viewer-locked', vc.elements === 2 && oc.elements === 2 && vc.readOnly === 1);

// Admin away (library) while the owner edits twice: overwritten seqs must not stall catch-up.
const readSeqs = (page) => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('as-tac-v2');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const links = await new Promise((resolve) => {
        const request = db.transaction('liveLinks').objectStore('liveLinks').getAll();
        request.onsuccess = () => resolve(request.result);
    });
    db.close();
    const link = links[0];
    const server = JSON.parse(localStorage.getItem(`as-tac-loopback:plan:${link.remoteId}`) ?? '{}');
    return { local: link.lastSeq, server: server.seq };
});
await admin.goto(base);
await admin.getByTestId('open-plan').first().waitFor();
await owner.keyboard.press('m');
await owner.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.3);
await settle(400);
await owner.keyboard.press('m');
await owner.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.35);
await settle(800);
await admin.getByTestId('open-plan').first().click();
await admin.waitForSelector('.maplibregl-canvas');
await settle(3500);
const seqs = await readSeqs(admin);
check('admin-caught-up', (await counts(admin)).elements === 4);
check('seq-advanced', seqs.local === seqs.server);
await settle(2500);
check('seq-stable', (await readSeqs(admin)).local === seqs.server);
// Undo the extra markers so the rest of the scenario keeps its counts.
await owner.keyboard.press('Escape');
await owner.keyboard.press('Control+z');
await owner.keyboard.press('Control+z');
await settle(1200);
check('admin-sees-undo', (await counts(admin)).elements === 2);

// Admin chat reaches the owner, never the viewer.
await panel(admin, 'Live');
await admin.getByPlaceholder('Nachricht an Admins').fill('Zug 2 bereit');
await admin.keyboard.press('Enter');
await settle(600);
await panel(owner, 'Live');
check('owner-chat', (await owner.locator('.chat__body', { hasText: 'Zug 2 bereit' }).count()) === 1);
await panel(viewer, 'Live');
check('viewer-no-chat', (await viewer.locator('.chat__body').count()) === 0);
check('presence', (await owner.locator('.person').count()) === 3);
await owner.screenshot({ path: `${out}/live-owner.png` });
await viewer.screenshot({ path: `${out}/live-viewer.png` });

// Briefing: owner leads, viewer follows and lands on the same phase.
await owner.keyboard.press('Escape');
await owner.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })));
await settle(500);
await owner.getByTestId('lead').click();
await settle(800);
await viewer.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' })));
await settle(500);
const follow = viewer.getByTestId('follow');
check('follow-offered', (await follow.count()) === 1);
if (await follow.count()) {
    await follow.click();
}
await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await owner.mouse.wheel(0, -400);
await settle(1500);
await viewer.screenshot({ path: `${out}/live-follow.png` });
check('viewer-following', (await viewer.getByTestId('follow').getAttribute('aria-pressed')) === 'true');
// Leadership is announced by the leader's broadcast; ending it reaches the followers.
await owner.getByTestId('lead').click();
await settle(1200);
check('leader-stopped', (await viewer.getByTestId('follow').count()) === 0);

await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
