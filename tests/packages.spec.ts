import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { validateBounds, validateData } from '../src/core/packages/maps';
const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Testweg', highway: 'path' }, geometry: { type: 'LineString', coordinates: [[8.63, 47.36], [8.631, 47.361]] } }] };
function fixture() {
    const json = JSON.stringify(data);
    return { format: 'as-tac-map', formatVersion: 1, id: 'local-11111111-1111-4111-8111-111111111111', name: 'Eigenes Testgebiet', bounds: [8.62, 47.349, 8.652, 47.373], dataTimestamp: '2026-10-01T00:00:00Z', source: 'Test fixture', attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0', byteSize: Buffer.byteLength(json), sha256: createHash('sha256').update(json).digest('hex'), data };
}
async function importPackage(page: Page, pkg = fixture()) {
    await page.getByLabel('Kartenpaket importieren (.astac-map.json)').setInputFiles({ name: 'test.astac-map.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg)) });
}
async function openPanel(page: Page) {
    await page.goto('/');
    await expect(page.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await page.getByText('Eigenes Gebiet laden oder importieren', { exact: true }).click();
}

test('area bounds and external geometry are bounded before installation', () => {
    expect(() => validateBounds([8.62, 47.349, 8.652, 47.373])).not.toThrow();
    expect(() => validateBounds([8, 47, 9, 48])).toThrow();
    expect(() => validateBounds([NaN, 47, 8.1, 47.01])).toThrow();
    expect(() => validateData(data)).not.toThrow();
    expect(() => validateData({ ...data, features: [{ ...data.features[0], geometry: { type: 'Point', coordinates: [181, 47] } }] })).toThrow();
});

test('import, offline reopen, export and referenced-package deletion guard', async ({ page, context }) => {
    await openPanel(page);
    await importPackage(page);
    await expect(page.getByText('Gebiet geprüft und lokal gespeichert.', { exact: true })).toBeVisible();
    await expect(page.locator('.map-caption')).toContainText('Eigenes Testgebiet');
    await page.getByLabel('Name des neuen Projekts').fill('Projekt mit eigenem Gebiet');
    await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Gebiet entfernen', exact: true }).click();
    await page.getByRole('button', { name: 'Gebiet endgültig entfernen', exact: true }).click();
    await expect(page.getByText('Dieses Gebiet wird von einem Projekt verwendet und kann nicht entfernt werden.')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Kartenpaket als Datei sichern', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.astac-map\.json$/);
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.map-caption')).toContainText('Eigenes Testgebiet');
    await expect(page.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await expect(page.getByLabel('Projektname', { exact: true })).toHaveValue('Projekt mit eigenem Gebiet');
});

test('corrupt hash, quota failure and aborted download keep current map and publish no partial package', async ({ page }) => {
    await openPanel(page);
    const before = await page.getByLabel('Vorbereitetes Gebiet').inputValue();
    await importPackage(page, { ...fixture(), sha256: 'invalid' });
    await expect(page.getByText('Grösse oder Prüfsumme stimmt nicht.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Vorbereitetes Gebiet')).toHaveValue(before);
    await page.evaluate(() => {
        navigator.storage.estimate = async () => ({ usage: 999, quota: 1_000 });
    });
    await importPackage(page);
    await expect(page.getByText('Nicht genügend freier Speicher für dieses Gebiet.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Vorbereitetes Gebiet').locator('option')).toHaveCount(2);
    await page.route('https://overpass-api.de/api/interpreter', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.abort();
    });
    await page.getByLabel('Gebietsname', { exact: true }).fill('Abbruch');
    await page.getByRole('button', { name: 'Gebiet offline speichern', exact: true }).click();
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(page.getByText('Abgebrochen. Vorhandene Gebiete bleiben erhalten.')).toBeVisible();
    await expect(page.getByLabel('Vorbereitetes Gebiet')).toHaveValue(before);
    await expect(page.getByLabel('Vorbereitetes Gebiet').locator('option')).toHaveCount(2);
});

test('custom bounds download converts OSM, installs offline, then unused package can be removed', async ({ page }) => {
    await page.route('https://overpass-api.de/api/interpreter', async (route) => {
        expect(route.request().postData()).toContain('47.349');
        await route.fulfill({ json: { osm3s: { timestamp_osm_base: '2026-10-01T00:00:00Z' }, elements: [{ type: 'node', id: 1, lat: 47.36, lon: 8.63, tags: { name: 'Testpunkt', tourism: 'viewpoint' } }] } });
    });
    await openPanel(page);
    await page.getByLabel('Gebietsname', { exact: true }).fill('Freie Auswahl');
    await page.getByRole('button', { name: 'Gebiet offline speichern', exact: true }).click();
    await expect(page.getByText('Gebiet geprüft und lokal gespeichert.', { exact: true })).toBeVisible();
    await expect(page.locator('.map-caption')).toContainText('Freie Auswahl');
    await page.getByRole('button', { name: 'Gebiet entfernen', exact: true }).click();
    await page.getByRole('button', { name: 'Gebiet endgültig entfernen', exact: true }).click();
    await expect(page.getByText('Gebiet entfernt.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Vorbereitetes Gebiet')).toHaveValue('benglen');
    await expect(page.getByLabel('Vorbereitetes Gebiet').locator('option')).toHaveCount(2);
});
