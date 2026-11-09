// Field catalog by country: no Zürich areas and no Riedikon, the catalog and a new plan open on the
// user's country (time zone; Germany where the catalog has no fields), a field installs from the
// server and a plan on it opens there; a plan whose basemap is neither a prepared field nor on the
// device says so instead of showing an empty map. Offline after the first visit, Mahlwinkel still
// installs (precached), other fields ask for the network.
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

const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', timezoneId: 'Europe/Zurich' });
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
page.on('console', (msg) => {
    if (msg.type() === 'error') {
        errors.push(`console: ${msg.text()}`);
    }
});
await page.goto(base);
await page.getByTestId('area-catalog').waitFor();

// The library: no Zürich and no Riedikon anywhere, the catalog opens on Switzerland (time zone).
check('no-zurich-in-library', !(await page.locator('.lib').getByText(/Zürich|Benglen|Riedikon/).count()));
const country = page.locator('.lib').getByTestId('area-country');
check('catalog-opens-on-home-country', (await country.inputValue()) === 'CH', await country.inputValue());
check('swiss-field-listed', /Steinbruch Dielsdorf/.test(await page.getByTestId('area-catalog').textContent()));
check('empty-library-suggests-home-field', await page.locator('.lib__empty').getByRole('button', { name: 'Neuer Plan auf Steinbruch Dielsdorf' }).waitFor({ timeout: 10000 }).then(() => true, () => false));
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

// New plan: opens on the home country's field; on a field in another country, the list follows the chosen country.
await page.getByTestId('new-plan').click();
const dialog = page.locator('.dialog');
check('new-plan-opens-on-home-country', (await dialog.getByTestId('area-country').inputValue()) === 'CH');
check('new-plan-starts-on-home-field', (await dialog.getByRole('radio', { name: /Steinbruch Dielsdorf/ }).getAttribute('aria-checked')) === 'true');
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

// Phone, Swiss German, in New York: no fields in the user's country, so the catalog opens on Germany.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'de-CH', timezoneId: 'America/New_York' });
const small = await phone.newPage();
small.on('pageerror', (error) => errors.push(`phone: ${error.message}`));
await small.goto(base);
await small.getByTestId('area-catalog').scrollIntoViewIfNeeded();
check('phone-abroad-opens-on-germany', (await small.getByTestId('area-country').inputValue()) === 'DE');
const link = small.getByTestId('area-catalog').getByRole('link').first();
const linkBox = await link.boundingBox();
check('website-link-tappable', Boolean(linkBox) && linkBox.width >= 48 && linkBox.height >= 48 && (await link.isVisible()), JSON.stringify(linkBox));
await small.screenshot({ path: `${out}/fields-phone.png` });

// France: a field already on the device comes first, for the empty library's button and «Feld wählen».
const paris = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
const fr = await paris.newPage();
fr.on('pageerror', (error) => errors.push(`france: ${error.message}`));
await fr.goto(base);
await fr.getByTestId('area-catalog').waitFor();
check('france-opens-on-france', (await fr.locator('.lib').getByTestId('area-country').inputValue()) === 'FR');
await fr.getByTestId('area-catalog').locator('.area-row').filter({ hasText: 'Bärenkopf' }).getByTestId('area-install').click();
await fr.getByTestId('area-installed').getByText(/Bärenkopf/).waitFor({ timeout: 60000 });
check('installed-field-suggested', await fr.locator('.lib__empty').getByRole('button', { name: /Neuer Plan auf Bärenkopf/ }).waitFor({ timeout: 10000 }).then(() => true, () => false));
await fr.locator('.lib__empty').getByRole('button', { name: 'Feld wählen' }).click();
const pick = fr.locator('.dialog').getByRole('radio', { name: /Bärenkopf/ });
check('pick-field-prefers-installed', await fr.waitForFunction(() => document.querySelector('.dialog [role=radio][aria-checked=true]')?.textContent?.includes('Bärenkopf'), null, { timeout: 10000 }).then(() => true, () => false), String(await pick.getAttribute('aria-checked')));
await paris.close();

// Switzerland, second opening of the dialog in one session: a plan on Steinbruch Dielsdorf saves the
// field; offline afterwards, «Neuer Plan» stays on it (the dialog must not judge from the list of its
// previous opening).
const zurich = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', timezoneId: 'Europe/Zurich', serviceWorkers: 'allow' });
const ch = await zurich.newPage();
ch.on('pageerror', (error) => errors.push(`zurich: ${error.message}`));
await ch.goto(base);
await ch.evaluate(() => navigator.serviceWorker.ready);
await ch.reload();
await ch.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30000 });
await ch.locator('.lib__empty').getByRole('button', { name: 'Neuer Plan auf Steinbruch Dielsdorf' }).click();
await ch.getByTestId('create-plan').click();
await ch.waitForSelector('.maplibregl-canvas', { timeout: 60000 });
await ch.getByTestId('back').click();
await ch.getByTestId('area-catalog').waitFor();
await zurich.setOffline(true);
await ch.getByTestId('new-plan').click();
await ch.waitForFunction(() => !document.querySelector('[data-testid=create-plan]')?.disabled);
await settle(800);
const again = ch.locator('.dialog');
check('second-opening-keeps-saved-field', (await again.getByTestId('area-country').inputValue()) === 'CH' && (await again.getByRole('radio', { name: /Steinbruch Dielsdorf/ }).getAttribute('aria-checked')) === 'true', await again.getByTestId('area-country').inputValue());
await zurich.close();

// Offline after the first visit, in Switzerland: Mahlwinkel comes from the precache, other fields
// need the network, so a new plan starts on Mahlwinkel while no Swiss field is on the device.
const offline = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-CH', timezoneId: 'Europe/Zurich', serviceWorkers: 'allow' });
const away = await offline.newPage();
away.on('pageerror', (error) => errors.push(`offline: ${error.message}`));
await away.goto(base);
await away.evaluate(() => navigator.serviceWorker.ready);
await away.reload();
await away.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30000 });
await offline.setOffline(true);
await away.getByTestId('area-catalog').waitFor();
await away.getByTestId('area-catalog').locator('.area-row').filter({ hasText: 'Steinbruch Dielsdorf' }).getByTestId('area-install').click();
const refused = await away.getByText('Für den Download ist eine Internetverbindung nötig.').waitFor({ timeout: 15000 }).then(() => true, () => false);
check('offline-field-needs-network', refused);
check('offline-empty-library-suggests-mahlwinkel', await away.locator('.lib__empty').getByRole('button', { name: /Neuer Plan auf Mahlwinkel/ }).isVisible());
await away.getByTestId('new-plan').click();
const offlineDialog = away.locator('.dialog');
const offlineMahlwinkel = await offlineDialog.getByRole('radio', { name: /Mahlwinkel/ }).waitFor({ timeout: 10000 }).then(() => true, () => false);
check('offline-default-is-mahlwinkel', offlineMahlwinkel && (await offlineDialog.getByRole('radio', { name: /Mahlwinkel/ }).getAttribute('aria-checked')) === 'true' && (await offlineDialog.getByTestId('area-country').inputValue()) === 'DE');
// A field that is not on the device, chosen anyway: the error offers Mahlwinkel.
await offlineDialog.getByTestId('area-country').selectOption('CH');
await offlineDialog.getByTestId('create-plan').click();
const offer = offlineDialog.getByTestId('new-plan-network').getByRole('button', { name: 'Mahlwinkel wählen' });
const offered = await offer.waitFor({ timeout: 15000 }).then(() => true, () => false);
if (offered) {
    await offer.click();
}
check('offline-failure-offers-mahlwinkel', offered && !(await offlineDialog.getByTestId('new-plan-network').count()) && (await offlineDialog.getByRole('radio', { name: /Mahlwinkel/ }).getAttribute('aria-checked')) === 'true');
check('offer-moves-focus-to-mahlwinkel', await away.waitForFunction(() => document.activeElement?.getAttribute('role') === 'radio' && document.activeElement.textContent.includes('Mahlwinkel'), null, { timeout: 5000 }).then(() => true, () => false));
await away.getByTestId('create-plan').click();
await away.waitForSelector('.maplibregl-canvas');
const offlineArea = await away.waitForFunction(() => new Promise((resolve) => {
    const request = indexedDB.open('as-tac-v2');
    request.onsuccess = () => {
        request.result.transaction('areaMeta').objectStore('areaMeta').get('mahlwinkel').onsuccess = (event) => {
            resolve(Boolean(event.target.result));
            request.result.close();
        };
    };
}), null, { timeout: 30000 }).then(() => true, () => false);
check('offline-mahlwinkel-from-precache', offlineArea);

await browser.close();
console.log(JSON.stringify(results, null, 1));
console.log(errors.length ? errors.join('\n') : 'no page errors');
process.exitCode = errors.length ? 1 : 0;
