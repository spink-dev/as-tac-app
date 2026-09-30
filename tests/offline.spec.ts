import { mkdtemp, rm } from 'node:fs/promises';
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
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await expect(page.locator('.map-label:visible').first()).toBeVisible();
    await page.getByText('Prüfdaten & Credits').click();
    await expect(page.getByText(/Renderer bereit/)).toBeVisible();
    await context.setOffline(true);
    await page.close();
    const offlinePage = await context.newPage();
    await offlinePage.goto('/');
    await expect(offlinePage.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await expect(offlinePage.locator('.map-label:visible').first()).toBeVisible();
    await offlinePage.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    await expect(offlinePage.locator('.map-caption')).toContainText('Zürich');
    await expect(offlinePage.locator('.map-label:visible').first()).toBeVisible();
    await offlinePage.screenshot({ path: 'test-results/offline-mobile.png', fullPage: true });
    expect(external).toEqual([]);
});

test('GPS stays local, shows accuracy, explore, outside bounds and stale fix', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 52.38, longitude: 11.82, accuracy: 15 });
    await page.goto('/');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Meine Position' }).click();
    await expect(page.locator('.coordinates')).toContainText('± 15 m');
    await expect(page.locator('.gps-dot')).toBeVisible();
    await page.getByRole('button', { name: 'Folgen pausieren' }).click();
    await expect(page.getByRole('button', { name: 'Position folgen' })).toBeVisible();
    await context.setGeolocation({ latitude: 47.35, longitude: 8.49, accuracy: 40 });
    await expect(page.getByText(/Ausserhalb des geladenen Gebiets/)).toBeVisible();
    await page.clock.install();
    await page.clock.fastForward(31_000);
    await expect(page.locator('.coordinates')).toContainText('VERALTET');
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
    await page.getByRole('button', { name: 'Meine Position' }).click();
    await expect(page.getByText(/Standortfreigabe verweigert/)).toBeVisible();
    await page.evaluate(() => {
        navigator.geolocation.watchPosition = (_success, error) => {
            error?.({ code: 3 } as GeolocationPositionError);
            return 2;
        };
    });
    await page.getByRole('button', { name: 'Meine Position' }).click();
    await expect(page.getByText(/GPS-Zeitlimit/)).toBeVisible();
    await expect(page.locator('.gps-dot')).toHaveCount(0);
});

test('removed cached resource invalidates offline readiness', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await expect(page.locator('.map-label:visible').first()).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(async () => {
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            await cache.delete('/maps/mahlwinkel.geojson');
        }
    });
    await page.getByRole('button', { name: 'Dateien prüfen' }).click();
    await expect(page.getByText(/Ressource fehlt/)).toBeVisible();
    await expect(page.getByText('Bereit für den Netztest')).toHaveCount(0);
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Offline-Paket reparieren' }).click();
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
});


test('browser process restarts offline using its persisted profile', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'as-tac-cold-'));
    let context = await chromium.launchPersistentContext(profile, { headless: true });
    try {
        const page = await context.newPage();
        await page.goto('http://localhost:4000/');
        await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
        await expect(page.locator('.map-label:visible').first()).toBeVisible();
        await context.close();
        context = await chromium.launchPersistentContext(profile, { headless: true, offline: true });
        const coldPage = await context.newPage();
        await coldPage.goto('http://localhost:4000/');
        await expect(coldPage.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
        await expect(coldPage.locator('.map-label:visible').first()).toBeVisible();
        await coldPage.getByText('Prüfdaten & Credits').click();
        await expect(coldPage.getByText(/Renderer bereit/)).toBeVisible();
        console.log('Desktop Chromium cold start:', await coldPage.getByText(/Kartenstart:/).innerText());
    } finally {
        await context.close();
        await rm(profile, { recursive: true, force: true });
    }
});

test('offline terrain does not require GeoJSON fetches from the map worker', async ({ page, context }) => {
    await page.goto('/');
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
    await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    await expect(page.locator('.map-label:visible').first()).toBeVisible();
    await page.getByText('Prüfdaten & Credits').click();
    await expect(page.getByText(/Renderer bereit/)).toBeVisible();
    await expect(page.locator('.map-error')).toHaveCount(0);
});
