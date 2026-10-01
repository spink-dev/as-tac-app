import { openTab } from './workspace-helpers';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { accuracyRing, outside, validFix } from '../src/core/location/position';

test('WGS84 validation, bounds and metric accuracy circle', () => {
    const fix = { longitude: 11.82, latitude: 52.38, accuracy: 25, timestamp: Date.now() };
    expect(validFix(fix)).toBe(true);
    expect(validFix({ ...fix, latitude: NaN })).toBe(false);
    expect(validFix({ ...fix, accuracy: -1 })).toBe(false);
    expect(outside(fix, [11.809, 52.376, 11.84, 52.3855])).toBe(false);
    expect(outside({ ...fix, longitude: 8.49 }, [11.809, 52.376, 11.84, 52.3855])).toBe(true);
    const ring = accuracyRing(fix).geometry.coordinates[0];
    expect(ring[0]).toEqual(ring.at(-1));
    expect((ring[0][1] - fix.latitude) * Math.PI / 180 * 6371008.8).toBeCloseTo(25, 4);
});

test('production shell, both maps and local labels survive offline new-page start', async ({ page, context }) => {
    const external: string[] = [];
    context.on('request', (request) => {
        if (!request.url().startsWith('http://localhost:4000') && !request.url().startsWith('blob:')) {
            external.push(request.url());
        }
    });
    await page.goto('/');
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await expect(page.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await context.setOffline(true);
    await page.close();
    const offlinePage = await context.newPage();
    await offlinePage.goto('/');
    await openTab(offlinePage, 'Karten');
    await expect(offlinePage.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await expect(offlinePage.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await openTab(offlinePage, 'Karten');
    await offlinePage.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    await expect(offlinePage.locator('.map-caption')).toContainText('Zürich');
    await expect(offlinePage.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await offlinePage.screenshot({ path: 'test-results/offline-mobile.png', fullPage: true });
    expect(external).toEqual([]);
});

test('GPS stays local, shows accuracy, explore, outside bounds and stale fix', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 52.38, longitude: 11.82, accuracy: 15 });
    await page.goto('/');
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await context.setOffline(true);
    await openTab(page, 'Orientierung');
    await page.getByRole('button', { name: 'Meine Position' }).click();
    await expect(page.locator('.coordinates')).toContainText('± 15 m');
    await expect(page.locator('.gps-dot')).toBeVisible();
    await openTab(page, 'Orientierung');
    await page.getByRole('button', { name: 'Folgen pausieren' }).click();
    await expect(page.getByRole('button', { name: 'Position folgen' })).toBeVisible();
    await context.setGeolocation({ latitude: 47.35, longitude: 8.49, accuracy: 40 });
    await expect(page.getByText(/Ausserhalb des geladenen Gebiets/)).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward(31_000);
    await expect(page.locator('.coordinates')).toContainText('VERALTET');
    await openTab(page, 'Orientierung');
    await page.getByRole('button', { name: 'GPS stoppen' }).click();
    await expect(page.getByRole('button', { name: 'Meine Position' })).toBeVisible();
});

test('permission denied and timeout are explicit', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'geolocation', { value: {
            watchPosition(_success: unknown, error: (value: { code: number }) => void) {
                error({ code: 1 });
                return 1;
            },
            clearWatch() {},
        } });
    });
    await page.goto('/');
    await openTab(page, 'Karten');
    await openTab(page, 'Orientierung');
    await page.getByRole('button', { name: 'Meine Position' }).click();
    await expect(page.getByText(/Standortfreigabe verweigert/)).toBeVisible();
    await page.evaluate(() => {
        navigator.geolocation.watchPosition = (_success, error) => {
            error?.({ code: 3 } as GeolocationPositionError);
            return 2;
        };
    });
    await openTab(page, 'Orientierung');
    await page.getByRole('button', { name: 'Meine Position' }).click();
    await expect(page.getByText(/GPS-Zeitlimit/)).toBeVisible();
    await expect(page.locator('.gps-dot')).toHaveCount(0);
});

test('removed cached resource invalidates offline readiness', async ({ page, context }) => {
    await page.goto('/');
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await expect(page.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(async () => {
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            await cache.delete('/maps/mahlwinkel.geojson');
        }
    });
    await openTab(page, 'Karten');
    await page.getByRole('button', { name: 'Dateien prüfen' }).click();
    await expect(page.getByText(/Ressource fehlt/)).toBeVisible();
    await expect(page.getByText('Offline verfügbar')).toHaveCount(0);
    await context.setOffline(false);
    await openTab(page, 'Karten');
    await page.getByRole('button', { name: 'Offline-Paket reparieren' }).click();
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
});


test('browser process restarts offline using its persisted profile', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'as-tac-cold-'));
    let context = await chromium.launchPersistentContext(profile, { headless: true });
    try {
        const page = await context.newPage();
        await page.goto('http://localhost:4000/');
        await openTab(page, 'Karten');
        await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
        await expect(page.locator('.map[aria-busy=\"false\"]')).toBeVisible();
        await openTab(page, 'Projekt');
        await page.getByLabel('Name des neuen Projekts').fill('Neustart-Nachweis');
        await openTab(page, 'Projekt');
        await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
        await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
        await context.close();
        context = await chromium.launchPersistentContext(profile, { headless: true, offline: true });
        const coldPage = await context.newPage();
        await coldPage.goto('http://localhost:4000/');
        await openTab(coldPage, 'Karten');
        await expect(coldPage.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
        await expect(coldPage.locator('.map[aria-busy=\"false\"]')).toBeVisible();
        await expect(coldPage.locator('.map')).toHaveAttribute('aria-busy', 'false');
        await expect(coldPage.getByLabel('Projektname', { exact: true })).toHaveValue('Neustart-Nachweis');
    } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
    }
});

test('offline terrain does not require GeoJSON fetches from the map worker', async ({ page, context }) => {
    await page.goto('/');
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await context.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
                const source = `
                    const originalFetch = self.fetch;
                    self.fetch = (input, options) => {
                        if (String(input?.url ?? input).includes('.geojson')) {
                            return Promise.reject(new TypeError('Simulated offline worker fetch failure'));
                        }
                        return originalFetch(input, options);
                    };
                    await import(${JSON.stringify(new URL(url, location.href).href)});
                `;
                super(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })),
                    { ...options, type: 'module' });
            }
        };
    });
    await context.setOffline(true);
    await page.reload();
    await openTab(page, 'Karten');
    await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    await expect(page.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.map-error')).toHaveCount(0);
});


test('app updates wait for consent and a broken update preserves the offline version', async ({ page, context }) => {
    const workerPath = join(process.cwd(), 'dist/sw.js');
    const original = await readFile(workerPath, 'utf8');
    const manifest = JSON.parse(original.split('\n')[0].slice('const MANIFEST = '.length, -1));
    await page.goto('/');
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await openTab(page, 'Karten');
    await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    try {
        const next = { ...manifest, version: 'test-valid-update' };
        await writeFile(workerPath, original.replace(original.split('\n')[0], `const MANIFEST = ${JSON.stringify(next)};`));
        await page.evaluate(async () => {
            await (await navigator.serviceWorker.getRegistration())?.update();
        });
        await expect(page.getByRole('button', { name: 'Update installieren und neu starten' })).toBeVisible();
        await expect(page.getByLabel('Vorbereitetes Gebiet')).toHaveValue('benglen');
        await expect.poll(() => page.evaluate(async () => {
            const channel = new MessageChannel();
            const message = new Promise<string>((resolve) => {
                channel.port1.onmessage = (event) => resolve(event.data.version);
            });
            navigator.serviceWorker.controller!.postMessage({ type: 'VERIFY' }, [channel.port2]);
            return message;
        })).toBe(manifest.version);
        await openTab(page, 'Projekt');
        await page.getByLabel('Name des neuen Projekts').fill('Update-Nachweis');
        await openTab(page, 'Projekt');
        await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
        await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
        await page.evaluate(() => {
            const put = IDBObjectStore.prototype.put;
            (window as any).restoreStorage = () => {
                IDBObjectStore.prototype.put = put;
            };
            IDBObjectStore.prototype.put = function (value: unknown) {
                if (this.name === 'projects') {
                    throw new DOMException('Full', 'QuotaExceededError');
                }
                return put.call(this, value);
            };
        });
        await openTab(page, 'Projekt');
        await page.getByLabel('Projektname', { exact: true }).fill('Update-Entwurf');
        await expect(page.getByText('Nicht gespeichert', { exact: true })).toBeVisible();
        await openTab(page, 'Karten');
        await expect(page.getByRole('button', { name: 'Update installieren und neu starten' })).toBeDisabled();
        await page.evaluate(() => (window as any).restoreStorage());
        await openTab(page, 'Projekt');
        await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
        await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
        await openTab(page, 'Karten');
        // Activation reloads asynchronously after controllerchange. Wait for the new
        // document before opening a tab, otherwise the click can target the old UI.
        await Promise.all([
            page.waitForEvent('domcontentloaded'),
            page.getByRole('button', { name: 'Update installieren und neu starten' }).click(),
        ]);
        await openTab(page, 'Karten');
        await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
        await expect(page.getByLabel('Projektname', { exact: true })).toHaveValue('Update-Entwurf');
        await expect(page.getByLabel('Vorbereitetes Gebiet')).toHaveValue('benglen');
        await expect(page.getByRole('button', { name: 'Update installieren und neu starten' })).toHaveCount(0);

        const broken = { ...next, version: 'test-broken-update',
            resources: next.resources.map((resource: { url: string; sha256: string }) =>
                resource.url === '/maps/benglen.geojson' ? { ...resource, sha256: 'invalid' } : resource) };
        await writeFile(workerPath, original.replace(original.split('\n')[0], `const MANIFEST = ${JSON.stringify(broken)};`));
        await page.evaluate(async () => {
            const registration = (await navigator.serviceWorker.getRegistration())!;
            const failed = new Promise<void>((resolve) => {
                registration.addEventListener('updatefound', () => {
                    const worker = registration.installing!;
                    worker.addEventListener('statechange', () => {
                        if (worker.state === 'redundant') {
                            resolve();
                        }
                    });
                }, { once: true });
            });
            await registration.update();
            await failed;
        });
        await context.setOffline(true);
        await page.reload();
        await openTab(page, 'Karten');
        await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
        await openTab(page, 'Karten');
        await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
        await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('.map-error')).toHaveCount(0);
    } finally {
        await writeFile(workerPath, original);
    }
});
