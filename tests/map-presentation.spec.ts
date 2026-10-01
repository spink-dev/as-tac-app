import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { eventProject, events } from '../src/features/catalog/catalog';
import { presentation } from '../src/features/editor/presentation';
import { verifyPackage, validateBounds } from '../src/core/packages/maps';
import { openTab, closePanel } from './workspace-helpers';

test('all event editions share boundary, HQ and zone semantics', () => {
    for (const event of events) {
        const project = eventProject(event.id);
        for (const element of project.elements) {
            const style = presentation(element);
            if (element.sourceId?.endsWith(':boundary')) {
                expect(style.labelMode).toBe('hidden');
            }
            if (element.sourceId?.includes(':hq:')) {
                expect(style.symbol).toBe('flag');
            }
            if (/^(Safe Zone|Zivile Zone)/i.test(element.label)) {
                expect(style).toMatchObject({ symbol: 'shield', pattern: 'hatch' });
            }
        }
    }
});

test('Zurich package verifies, exports independently and covers both Zurich campuses and Benglen', async () => {
    const metadata = JSON.parse(readFileSync('public/maps/zurich.json', 'utf8'));
    const data = JSON.parse(readFileSync('public/maps/zurich.geojson', 'utf8'));
    const pkg = await verifyPackage({ ...metadata, format: 'as-tac-map', formatVersion: 1, data });
    // Wider prepared packages can round-trip through independent local imports; ad-hoc downloads remain small.
    await verifyPackage({ ...pkg, id: `local-${crypto.randomUUID()}` });
    expect(() => validateBounds(pkg.bounds)).toThrow();
    for (const [lon, lat] of [[8.532635, 47.377651], [8.511383, 47.390659], [8.636, 47.36]]) {
        expect(lon).toBeGreaterThan(pkg.bounds[0]);
        expect(lon).toBeLessThan(pkg.bounds[2]);
        expect(lat).toBeGreaterThan(pkg.bounds[1]);
        expect(lat).toBeLessThan(pkg.bounds[3]);
    }
});

test('Zurich reopens offline with bounded labels and each event renders without map errors', async ({ page, context }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await openTab(page, 'Karten');
    await page.getByLabel('Vorbereitetes Gebiet').selectOption('zurich');
    await expect(page.locator('.map[aria-busy="false"]')).toBeVisible();
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible({ timeout: 60_000 });
    await closePanel(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 47.377651, longitude: 8.532635, accuracy: 8 });
    await page.getByRole('button', { name: /Meine Position/ }).click();
    for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    }
    await page.getByLabel('Orts- und POI-Namen', { exact: true }).check();
    await expect(page.locator('.road-name').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('.map[aria-busy="false"]')).toBeVisible();
    expect(await page.locator('.basemap-labels text').count()).toBeLessThanOrEqual(180);
    await page.screenshot({ path: 'test-results/zurich-map.png' });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.map-caption')).toContainText('Zürich Stadt');
    await expect(page.locator('.map[aria-busy="false"]')).toBeVisible();
    await expect(page.locator('.map-error')).toHaveCount(0);
    await context.setOffline(false);
    for (const event of events) {
        await openTab(page, 'Karten');
        await page.getByLabel('Event', { exact: true }).selectOption(event.id);
        await page.getByRole('button', { name: 'Eventkarte offline speichern' }).click();
        await expect(page.getByText(/Eventkarte auf diesem Gerät gespeichert/)).toBeVisible();
        await expect(page.locator('.map[aria-busy="false"]')).toBeVisible();
        await closePanel(page);
        await expect(page.locator('.plan-label').filter({ hasText: 'Spielfeldgrenze' })).toHaveCount(0);
        await expect(page.locator('.map-error')).toHaveCount(0);
        await page.screenshot({ path: `test-results/map-${event.id}.png` });
    }
    expect(errors).toEqual([]);
});
