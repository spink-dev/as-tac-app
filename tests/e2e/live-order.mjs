// List order across app versions and catch-ups (test mode, objects injected on the test server):
// a newer partner inserts X mid-list and edits it again while this device is away, so a catch-up
// meets the order list before X. After this device "updates", X must sit where the partner put it.
// Also: a tag implausibly far ahead counts as broken — it must not lock this device.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
try {
    playwright = require('playwright');
} catch {
    playwright = require('/opt/npm-tools/node_modules/playwright');
}
const base = process.env.BASE_URL ?? 'http://localhost:4000';
const browser = await playwright.chromium.launch();
const log = (...a) => console.log(...a);
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', timezoneId: 'Europe/Berlin' });
const errors = [];
const results = {};
const check = (name, ok, detail = '') => {
    results[name] = ok;
    if (!ok) {
        errors.push(`check failed: ${name} ${detail}`);
    }
};
const watch = (page, name) => page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
const counts = (page) => page.evaluate(() => window.__asTacCounts());
const panel = async (page, name) => {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
    await page.waitForFunction(() => document.activeElement?.closest('.palette'));
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
};
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const mark = async (page, fx, fy = 0.5) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    const box = await page.locator('.maplibregl-canvas').boundingBox();
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await settle();
};
const idb = (page, store, key) => page.evaluate(({ store, key }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('as-tac-v2');
    open.onsuccess = () => {
        const tx = open.result.transaction(store, 'readonly');
        const req = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
}), { store, key });

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
const code = (await owner.getByTestId('invite-code').textContent()).replace(/\s/g, '');
const newer = await context.newPage();
watch(newer, 'newer');
await newer.goto(`${base}/#join=${code}`);
await newer.getByTestId('join-code').waitFor();
await newer.getByTestId('join-submit').click();
await newer.waitForSelector('.maplibregl-canvas');
await settle(1200);
await mark(owner, 0.3); // A
await mark(newer, 0.6, 0.6); // Y
await owner.waitForFunction(() => window.__asTacCounts().elements === 2, null, { timeout: 20000 });
await settle(1500);
const planKey = await owner.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith('as-tac-loopback:plan:')));
const server = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), planKey);
let s = await server(owner);
const els = Object.values(s.entities).filter((e) => e.collection === 'elements');
const a = els.find((e) => e.clientId !== els.find((x) => x.data.id)?.clientId) ?? els[0];
const ids = els.map((e) => e.entityId);
log('elements on server', ids.length);

// Far-ahead tag first: F (format current+21) must count as broken, not lock the device.
await owner.evaluate(({ k, tpl }) => {
    const st = JSON.parse(localStorage.getItem(k));
    const f = { ...tpl, id: 'el_far_ahead', _fv: 22 };
    st.seq += 1;
    st.entities['elements:el_far_ahead'] = { collection: 'elements', entityId: 'el_far_ahead', data: f, version: 1, seq: st.seq, clientId: 'c_injected' };
    localStorage.setItem(k, JSON.stringify(st));
}, { k: planKey, tpl: els[0].data });
await owner.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await settle(2000);
check('far-ahead-tag-does-not-lock', !/Update nötig/.test(await owner.locator('.live-badge').textContent()));
check('far-ahead-object-skipped', (await counts(owner)).elements === 2, String((await counts(owner)).elements));

// X created (format 2) + order [Y?, X, ...] + X edited again: X's row ends up with the highest seq.
const [first, second] = ids;
await owner.evaluate(({ k, tpl, first, second }) => {
    const st = JSON.parse(localStorage.getItem(k));
    const x = { ...tpl, id: 'el_newer_x', _fv: 2 };
    st.seq += 1;
    st.entities['elements:el_newer_x'] = { collection: 'elements', entityId: 'el_newer_x', data: x, version: 1, seq: st.seq, clientId: 'c_injected' };
    st.seq += 1;
    const prev = st.entities['order:elements'];
    st.entities['order:elements'] = { collection: 'order', entityId: 'elements', data: [second, 'el_newer_x', first], version: (prev?.version ?? 0) + 1, seq: st.seq, clientId: 'c_injected' };
    st.seq += 1;
    st.entities['elements:el_newer_x'] = { collection: 'elements', entityId: 'el_newer_x', data: { ...x, label: 'renamed' }, version: 2, seq: st.seq, clientId: 'c_injected' };
    localStorage.setItem(k, JSON.stringify(st));
}, { k: planKey, tpl: els[0].data, first, second });
await owner.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
check('newer-object-holds-device', await owner.locator('.live-badge').filter({ hasText: /Update nötig/ }).waitFor({ timeout: 20000 }).then(() => true, () => false));
const ownerUser = await owner.evaluate(() => sessionStorage.getItem('as-tac-loopback:user'));
const link0 = (await idb(owner, 'liveLinks')).find((l) => l.userId === ownerUser);
let local = (await idb(owner, 'projects', link0.projectId)).data.elements.map((e) => e.id);
log('owner order while outdated', JSON.stringify(local.map((id) => (id === first ? 'first' : id === second ? 'second' : id))));
await settle(2500);
const link = (await idb(owner, 'liveLinks')).find((l) => l.userId === ownerUser);
s = await server(owner);
log('stored lastSeq', link.lastSeq, 'order seq', s.entities['order:elements'].seq, 'X seq', s.entities['elements:el_newer_x'].seq);

await owner.evaluate((k) => {
    const st = JSON.parse(localStorage.getItem(k));
    for (const e of Object.values(st.entities)) {
        if (e.data && e.data._fv === 2) {
            e.data._fv = 1;
        }
    }
    localStorage.setItem(k, JSON.stringify(st));
}, planKey);
await owner.evaluate((id) => sessionStorage.setItem('as-tac.resume', JSON.stringify({ projectId: id, mode: 'plan', streamer: 'off', at: Date.now() })), link.projectId);
await owner.reload();
await owner.waitForSelector('.maplibregl-canvas');
await settle(5000);
s = await server(owner);
local = (await idb(owner, 'projects', link.projectId)).data.elements.map((e) => e.id);
const name = (id) => (id === first ? 'first' : id === second ? 'second' : id);
const serverOrder = s.entities['order:elements'].data.map(name);
const ownerOrder = local.map(name);
check('order-after-update-matches-partner', JSON.stringify(ownerOrder) === JSON.stringify(serverOrder), `${JSON.stringify(ownerOrder)} vs ${JSON.stringify(serverOrder)}`);
await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
