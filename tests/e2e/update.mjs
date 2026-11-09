// A real update between two builds: the app notices the new version, downloads it in the background,
// applies it only on tap, saves first, and reopens the same plan in the same mode. A second tab is
// told to reload. Builds both versions itself unless UPDATE_DIST_A / UPDATE_DIST_B point to builds.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try {
    playwright = require('playwright');
} catch {
    playwright = require('/opt/npm-tools/node_modules/playwright');
}
const out = process.argv[2] ?? 'tests/e2e/screenshots';
const errors = [];
const results = {};
const check = (name, ok, detail = '') => {
    results[name] = ok;
    if (!ok) {
        errors.push(`check failed: ${name} ${detail}`);
    }
};

const NEXT = '1.0.0-alpha.99';
function build(version, commit) {
    const dir = mkdtempSync(join(tmpdir(), `astac-${commit}-`));
    const run = spawnSync('npx', ['vite', 'build', '--outDir', dir, '--emptyOutDir'], {
        encoding: 'utf8', env: { ...process.env, BUILD_VERSION: version, BUILD_COMMIT: commit }, timeout: 300000,
    });
    if (run.status !== 0) {
        throw new Error(`build ${commit} failed:\n${run.stdout}\n${run.stderr}`);
    }
    return dir;
}
const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const built = [];
const distA = process.env.UPDATE_DIST_A ?? built[built.push(build(current, 'e2e-a')) - 1];
const distB = process.env.UPDATE_DIST_B ?? built[built.push(build(NEXT, 'e2e-b')) - 1];

// Static server like docker/nginx.conf: hashed assets immutable, everything else revalidated, SPA fallback.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.md': 'text/markdown', '.pbf': 'application/x-protobuf', '.geojson': 'application/geo+json' };
let root = distA;
const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!existsSync(file) || statSync(file).isDirectory()) {
        if (extname(path)) {
            res.writeHead(404).end();
            return;
        }
        file = join(root, 'index.html');
    }
    res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : path === '/version.json' ? 'no-store' : 'no-cache',
    });
    res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://localhost:${server.address().port}`;

const browser = await playwright.chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', timezoneId: 'Europe/Berlin' });
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
const controlled = (page) => page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 60000 }).then(() => true, () => false);

// Tab 1: version A, offline-ready, a plan with one marker, in field mode.
const page = await context.newPage();
watch(page, 'tab1');
await page.goto(base);
await page.getByTestId('new-plan').waitFor();
check('a-controlled', await controlled(page));
check('a-version-shown', (await page.getByTestId('app-version').textContent())?.includes(current), await page.getByTestId('app-version').textContent());
await page.getByTestId('update-check').click();
check('a-current', await page.getByTestId('update-status').filter({ hasText: /aktuell/ }).waitFor({ timeout: 20000 }).then(() => true, () => false),
    await page.getByTestId('update-status').textContent());
await page.getByTestId('new-plan').click();
await page.getByTestId('create-plan').click();
await page.waitForSelector('.maplibregl-canvas');
await page.waitForTimeout(1200);
const before = (await page.evaluate(() => window.__asTacCounts())).elements;
await page.keyboard.press('Escape');
await page.keyboard.press('m');
const box = await page.locator('.maplibregl-canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
await page.waitForTimeout(300);
const marked = (await page.evaluate(() => window.__asTacCounts())).elements;
check('marker-added', marked === before + 1, `${before} → ${marked}`);
// Streamer Safe on: a privacy view that must survive the update (the plan must never show on stream).
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
await page.waitForFunction(() => document.activeElement?.closest('.palette'));
await page.keyboard.type('Streamer');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('streamer-on-before', (await page.locator('.topbar .badge--warn').textContent().catch(() => ''))?.includes('Streamer'));
await page.getByTestId('mode-field').click();

// Tab 2: the start screen of version A.
const other = await context.newPage();
watch(other, 'tab2');
await other.goto(base);
await other.getByTestId('new-plan').waitFor();

// The server now has version B.
await other.evaluate(() => {
    window.__notReloaded = true;
});
root = distB;
// Field mode keeps panels closed: the check runs in the start-screen tab; the plan tab learns of the
// installed version from the shared service worker registration.
await other.getByTestId('update-check').click();
const readyInOther = await other.getByTestId('update-banner').filter({ hasText: NEXT }).waitFor({ timeout: 90000 }).then(() => true, () => false);
check('b-found-and-downloaded', readyInOther, await other.getByTestId('update-status').textContent());
const topbar = await page.getByTestId('update-topbar').waitFor({ timeout: 30000 }).then(() => true, () => false);
check('plan-view-offers-update', topbar);
check('nothing-switched-yet', (await page.evaluate(() => document.querySelector('[data-testid="mode-field"]')?.getAttribute('aria-pressed'))) === 'true');
await page.screenshot({ path: `${out}/update-ready.png` });

// One tap in the plan view: save, switch, reopen the same plan in field mode.
await Promise.all([page.waitForEvent('load', { timeout: 60000 }), page.getByTestId('update-topbar').click()]);
await page.waitForSelector('.maplibregl-canvas', { timeout: 60000 });
await page.waitForTimeout(1500);
check('same-plan-reopened', (await page.evaluate(() => window.__asTacCounts())).elements === marked);
check('field-mode-kept', (await page.getByTestId('mode-field').getAttribute('aria-pressed')) === 'true');
check('streamer-kept', (await page.locator('.topbar .badge--warn').textContent().catch(() => ''))?.includes('Streamer') && (await page.locator('.topbar__name').textContent()) === 'AS-TAC');
const toast = await page.getByText(`Aktualisiert auf Version ${NEXT}`).waitFor({ timeout: 10000 }).then(() => true, () => false);
check('update-announced', toast);
check('runs-b', (await page.evaluate(async () => (await (await fetch('/version.json', { cache: 'no-store' })).json()).commit)) === 'e2e-b');
await page.getByTestId('mode-plan').click();
await panel(page, 'Einstellungen');
check('b-version-shown', (await page.getByTestId('app-version').textContent())?.includes(NEXT), await page.getByTestId('app-version').textContent());
await page.screenshot({ path: `${out}/update-done.png` });

// Tab 2 still runs version A: it must say so and reload on request.
check('other-tab-not-force-reloaded', (await other.evaluate(() => window.__notReloaded === true)));
const told = await other.getByTestId('update-banner').filter({ hasText: /anderen Fenster/ }).waitFor({ timeout: 20000 }).then(() => true, () => false);
check('other-tab-told', told, await other.getByTestId('update-banner').textContent().catch(() => 'no banner'));
await Promise.all([other.waitForEvent('load', { timeout: 30000 }), other.getByTestId('update-banner').getByTestId('update-apply').click()]);
await other.getByTestId('new-plan').waitFor();
check('other-tab-on-b', (await other.getByTestId('app-version').textContent())?.includes(NEXT));

await browser.close();
server.close();
for (const dir of built) {
    rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
