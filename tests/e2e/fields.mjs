// Field catalog by country: no Zürich areas, the catalog opens on the browser's region, a field
// installs from the server and a plan on it opens there; a plan whose basemap is neither a
// prepared field nor on the device says so instead of showing an empty map.
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
const settle = (ms = 800) => new Promise((resolve) => setTimeout(resolve, ms));

const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH' });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
page.on('console', (msg) => {
    if (msg.type() === 'error') {
        errors.push(`console: ${msg.text()}`);
    }
});
await page.goto(base);
await page.getByTestId('area-catalog').waitFor();

// The library: no Zürich anywhere, the catalog opens on Switzerland (browser region de-CH).
check('no-zurich-in-library', !(await page.locator('.lib').getByText(/Zürich|Benglen/).count()));
const country = page.locator('.lib').getByTestId('area-country');
check('catalog-opens-on-region', (await country.inputValue()) === 'CH', await country.inputValue());
check('swiss-fields-listed', /Riedikon/.test(await page.getByTestId('area-catalog').textContent()));
const countries = await country.locator('option').count();
check('several-countries', countries >= 10, String(countries));
check('nothing-installed-yet', await page.getByText('Noch kein Gebiet offline gespeichert.').isVisible());

// France → Bärenkopf, saved offline from the app's own server.
await country.selectOption('FR');
const row = page.getByTestId('area-catalog').locator('.area-row').filter({ hasText: 'Bärenkopf' });
check('baerenkopf-in-france', (await row.count()) === 1);
await row.getByTestId('area-install').click();
const installed = await page.getByTestId('area-installed').getByText(/Bärenkopf/).waitFor({ timeout: 60000 }).then(() => true, () => false);
check('baerenkopf-installed', installed);
check('catalog-marks-installed', /Auf dem Gerät/.test(await row.textContent()));
await page.screenshot({ path: `${out}/fields-library.png` });

// New plan on a field in another country: the list follows the chosen country.
await page.getByTestId('new-plan').click();
const dialog = page.locator('.dialog');
await dialog.getByTestId('area-country').selectOption('AT');
const firstAt = dialog.getByTestId('new-plan-areas').getByRole('radio').first();
check('country-switch-selects-a-visible-field', (await firstAt.getAttribute('aria-checked')) === 'true');
await dialog.getByTestId('area-country').selectOption('FR');
await dialog.getByRole('radio', { name: /Bärenkopf/ }).click();
await page.screenshot({ path: `${out}/fields-new-plan.png` });
await page.getByTestId('create-plan').click();
await page.waitForSelector('.maplibregl-canvas');
await settle(2500);
const camera = await page.evaluate(() => window.__asTacCamera());
check('plan-opens-on-the-field', Boolean(camera) && Math.abs(camera.center[0] - 6.744) < 0.02 && Math.abs(camera.center[1] - 47.859) < 0.02, JSON.stringify(camera));
const stored = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('as-tac-v2');
    request.onsuccess = () => {
        request.result.transaction('areaMeta').objectStore('areaMeta').get('fr-baerenkopf').onsuccess = (event) => {
            resolve(event.target.result?.meta ?? null);
            request.result.close();
        };
    };
}));
check('area-stored-with-data', Boolean(stored) && stored.featureCount > 100 && stored.origin === 'bundled', JSON.stringify(stored && { n: stored.featureCount, origin: stored.origin }));

// A plan on a basemap this device doesn't have and the catalog doesn't know (e.g. the old Zürich area).
const projectId = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('as-tac-v2');
    request.onsuccess = () => {
        const tx = request.result.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');
        store.getAll().onsuccess = (event) => {
            const row = event.target.result[0];
            row.data.areaId = 'zurich';
            store.put(row);
            tx.oncomplete = () => {
                resolve(row.id);
                request.result.close();
            };
        };
    };
}));
await page.evaluate((id) => sessionStorage.setItem('as-tac.resume', JSON.stringify({ projectId: id, mode: 'plan', streamer: 'off', at: Date.now() })), projectId);
await page.reload();
await page.waitForSelector('.maplibregl-canvas', { timeout: 60000 });
const told = await page.getByText(/Grundkarte «zurich» ist auf diesem Gerät nicht vorhanden/).waitFor({ timeout: 15000 }).then(() => true, () => false);
check('missing-basemap-reported', told);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
await page.waitForFunction(() => document.activeElement?.closest('.palette'));
await page.keyboard.type('Karten');
await page.keyboard.press('Enter');
await settle(500);
const select = page.locator('select').filter({ has: page.locator('option[value="zurich"]') });
check('maps-panel-names-missing-area', (await select.count()) === 1 && (await select.inputValue()) === 'zurich');
check('maps-panel-groups-by-country', (await select.locator('optgroup').count()) >= 10, String(await select.locator('optgroup').count()));
await page.screenshot({ path: `${out}/fields-missing.png` });

// Phone: the catalog in the library.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-DE' });
const small = await phone.newPage();
small.on('pageerror', (error) => errors.push(`phone: ${error.message}`));
await small.goto(base);
await small.getByTestId('area-catalog').scrollIntoViewIfNeeded();
check('phone-opens-on-germany', (await small.getByTestId('area-country').inputValue()) === 'DE');
await small.screenshot({ path: `${out}/fields-phone.png`, fullPage: true });

await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
