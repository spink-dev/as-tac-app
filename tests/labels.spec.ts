import { openTab, closePanel } from './workspace-helpers';
import { test, expect } from '@playwright/test';

test('street names follow paths offline; point names are opt-in and labels fit their roads', async ({ page, context }) => {
    await page.goto('/');
    await openTab(page, 'Karten');
    await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    await expect(page.locator('.map-caption')).toContainText('Benglen');
    await expect(page.locator('.map[aria-busy="false"]')).toBeVisible();
    await closePanel(page);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await closePanel(page);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const roads = page.locator('.road-name').filter({ visible: true });
    await expect(roads.first()).toBeVisible();
    expect(await page.locator('.place-name').evaluateAll((elements) => elements.every((e) => getComputedStyle(e).visibility === 'hidden'))).toBe(true);
    expect(await roads.evaluateAll((elements) => elements.every((element) => {
        const text = element as SVGTextElement;
        const path = document.querySelector(text.querySelector('textPath')!.getAttribute('href')!) as SVGPathElement;
        return path.getTotalLength() >= text.getComputedTextLength() + 32;
    }))).toBe(true);
    await closePanel(page);
    await page.getByLabel('Strassennamen', { exact: true }).uncheck();
    await expect(roads).toHaveCount(0);
    await closePanel(page);
    await page.getByLabel('Orts- und POI-Namen', { exact: true }).check();
    await expect(page.getByLabel('Orts- und POI-Namen', { exact: true })).toBeChecked();
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await context.setOffline(true);
    await closePanel(page);
    await page.getByLabel('Orts- und POI-Namen', { exact: true }).uncheck();
    await closePanel(page);
    await page.getByLabel('Strassennamen', { exact: true }).check();
    await expect(roads.first()).toBeVisible();
    await page.locator('.map-wrap').screenshot({ path: 'test-results/street-labels.png' });
});
