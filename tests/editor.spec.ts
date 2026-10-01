import { test, expect, type Page } from '@playwright/test';
import { distance, displayGeometry, measurements, translate, withVertices } from '../src/features/editor/geometry';

test('geodesic distances, circles, polygon area and vertex replacement retain WGS84 semantics', () => {
    expect(distance([0, 0], [0, 0.001])).toBeCloseTo(111.195, 2);
    const circle = displayGeometry({ type: 'Circle', center: [8.63, 47.36], radiusMeters: 100 }) as GeoJSON.Polygon;
    expect(circle.coordinates[0][0]).toEqual(circle.coordinates[0].at(-1));
    expect(distance([8.63, 47.36], circle.coordinates[0][0] as [number, number])).toBeCloseTo(100, 4);
    expect(measurements({ type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]] }).area).toBeCloseTo(12364.346, 1);
    const polygon = { type: 'Polygon' as const, coordinates: [[[8, 47], [8.1, 47], [8.1, 47.1], [8, 47]]] as [number, number][][] };
    const edited = withVertices(polygon, [[8, 47], [8.05, 47], [8.1, 47.1]]);
    expect(edited.type === 'Polygon' && edited.coordinates[0][0]).toEqual(edited.type === 'Polygon' && edited.coordinates[0].at(-1));
    expect(translate({ type: 'Point', coordinates: [8, 47] }, [8.2, 47.2])).toEqual({ type: 'Point', coordinates: [8.2, 47.2] });
});
async function prepare(page: Page) {
    await page.goto('/');
    await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    await expect(page.locator('.map-caption')).toContainText('Benglen');
    await page.getByLabel('Name des neuen Projekts').fill('Editor-Test');
    await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Plan bearbeiten', exact: true }).click();
}
async function tool(page: Page, name: string) {
    await page.getByRole('group', { name: 'Zeichenwerkzeuge' }).getByRole('button', { name, exact: true }).click();
}
async function point(page: Page, x: number, y: number) {
    await page.locator('.maplibregl-canvas').click({ position: { x, y } });
}
async function saved(page: Page) {
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toBeVisible();
}

test('all six drawing types persist offline; attributes, coordinates, deletion and undo are reversible', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await prepare(page);
    await tool(page, 'Punkt');
    await point(page, 70, 160);
    await expect(page.locator('.element-list li')).toHaveCount(1);
    await page.getByLabel('Beschriftung', { exact: true }).fill('Sammelpunkt');
    await page.getByLabel('Notizen', { exact: true }).fill('Tor öffnen\nKein GPS-Tracking');
    await page.getByLabel('Koordinaten / Eckpunkte', { exact: true }).fill('8.627, 47.37');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await expect(page.locator('.element-list')).toContainText('Sammelpunkt');
    await tool(page, 'Text');
    await point(page, 230, 155);
    await tool(page, 'Linie');
    await point(page, 60, 255);
    await point(page, 140, 265);
    await page.getByRole('button', { name: 'Zeichnung abschliessen', exact: true }).click();
    await tool(page, 'Fläche');
    await point(page, 215, 250);
    await point(page, 285, 255);
    await point(page, 250, 305);
    await page.getByRole('button', { name: 'Zeichnung abschliessen', exact: true }).click();
    await tool(page, 'Kreis');
    await point(page, 85, 350);
    await point(page, 115, 350);
    await page.getByLabel('Radius in Metern').fill('50');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await tool(page, 'Freihand');
    const canvas = page.locator('.maplibregl-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 210, box.y + 380);
    await page.mouse.down();
    await page.mouse.move(box.x + 280, box.y + 400, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.element-list li')).toHaveCount(6);
    await page.getByRole('button', { name: 'Element löschen', exact: true }).click();
    await expect(page.locator('.element-list li')).toHaveCount(5);
    await page.getByRole('button', { name: 'Plan rückgängig', exact: true }).click();
    await expect(page.locator('.element-list li')).toHaveCount(6);
    await saved(page);
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.element-list li')).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Plan bearbeiten', exact: true })).toBeVisible();
    await page.locator('.element-list button').filter({ hasText: 'Sammelpunkt' }).click();
    await expect(page.locator('.notes')).toContainText('Tor öffnen');
    await expect(page.locator('.plan-label')).toHaveCount(6);
    await page.getByLabel('Planelemente anzeigen').uncheck();
    await expect(page.locator('.plan-label')).toHaveCount(0);
    await page.getByLabel('Planelemente anzeigen').check();
    await expect(page.locator('.plan-label')).toHaveCount(6);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
});

test('cancel, invalid edits and map dragging leave stored geometry intact; drag handles commit once', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await prepare(page);
    await tool(page, 'Linie');
    await point(page, 240, 300);
    await page.keyboard.press('Escape');
    await expect(page.locator('.element-list li')).toHaveCount(0);
    const canvas = page.locator('.maplibregl-canvas');
    const bounds = (await canvas.boundingBox())!;
    await page.mouse.move(bounds.x + 300, bounds.y + 300);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 350, bounds.y + 330, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.element-list li')).toHaveCount(0);
    await tool(page, 'Punkt');
    await point(page, 300, 300);
    await page.getByLabel('Koordinaten / Eckpunkte').fill('8.63, 47.36');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await saved(page);
    await page.getByLabel('Koordinaten / Eckpunkte').fill('181, 47');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await expect(page.getByRole('alert').first()).toContainText('Ungültige');
    await page.getByRole('button', { name: 'Plan rückgängig', exact: true }).click();
    await page.getByRole('button', { name: 'Plan wiederholen', exact: true }).click();
    await expect(page.getByLabel('Koordinaten / Eckpunkte')).toHaveValue('8.63, 47.36');
    // A visible draggable handle changes the plan on release, and undo restores exact coordinates.
    const handle = page.getByRole('button', { name: 'Element verschieben', exact: true });
    await handle.scrollIntoViewIfNeeded();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 24, box.y + 24);
    await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y + 54, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByLabel('Koordinaten / Eckpunkte')).not.toHaveValue('8.63, 47.36');
    await page.getByRole('button', { name: 'Plan rückgängig', exact: true }).click();
    await expect(page.getByLabel('Koordinaten / Eckpunkte')).toHaveValue('8.63, 47.36');
    await tool(page, 'Linie');
    await point(page, 110, 480);
    await point(page, 230, 580);
    await page.getByRole('button', { name: 'Zeichnung abschliessen', exact: true }).click();
    const original = await page.getByLabel('Koordinaten / Eckpunkte').inputValue();
    const vertex = (await page.getByRole('button', { name: 'Eckpunkt 1', exact: true }).boundingBox())!;
    await page.mouse.move(vertex.x + 24, vertex.y + 24);
    await page.mouse.down();
    await page.mouse.move(vertex.x + 64, vertex.y + 44, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByLabel('Koordinaten / Eckpunkte')).not.toHaveValue(original);
    await page.getByRole('button', { name: 'Plan rückgängig', exact: true }).click();
    await expect(page.getByLabel('Koordinaten / Eckpunkte')).toHaveValue(original);
});

test('touch taps draw a closed polygon and field mode does not create elements', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://localhost:4000', hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });
    const page = await context.newPage();
    await prepare(page);
    await tool(page, 'Fläche');
    const canvas = page.locator('.maplibregl-canvas');
    await canvas.scrollIntoViewIfNeeded();
    let box = (await canvas.boundingBox())!;
    for (const [x, y] of [[70, 200], [210, 210], [120, 320]]) {
        await page.touchscreen.tap(box.x + x, box.y + y);
    }
    await page.getByRole('button', { name: 'Zeichnung abschliessen', exact: true }).tap();
    await expect(page.locator('.element-list li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Zur Feldansicht', exact: true }).tap();
    await canvas.scrollIntoViewIfNeeded();
    box = (await canvas.boundingBox())!;
    await page.touchscreen.tap(box.x + 280, box.y + 350);
    await expect(page.locator('.element-list li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Plan bearbeiten', exact: true }).tap();
    await tool(page, 'Freihand');
    await canvas.scrollIntoViewIfNeeded();
    box = (await canvas.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 230, y: box.y + 360 }] });
    for (let step = 1; step <= 8; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 230 + step * 6, y: box.y + 360 + step * 3 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.element-list li')).toHaveCount(2);
    await saved(page);
    await context.close();
});

test('active tools draw over existing objects without selecting the object underneath', async ({ page }) => {
    await prepare(page);
    await tool(page, 'Fläche');
    await point(page, 100, 180);
    await point(page, 290, 180);
    await point(page, 290, 330);
    await point(page, 100, 330);
    await page.getByRole('button', { name: 'Zeichnung abschliessen', exact: true }).click();
    await expect(page.locator('.element-list li')).toHaveCount(1);
    await tool(page, 'Punkt');
    await point(page, 190, 250);
    await expect(page.locator('.element-list li')).toHaveCount(2);
    await tool(page, 'Linie');
    await point(page, 190, 250);
    await expect(page.getByRole('button', { name: 'Linie', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await point(page, 250, 290);
    await page.getByRole('button', { name: 'Zeichnung abschliessen', exact: true }).click();
    await expect(page.locator('.element-list li')).toHaveCount(3);
    await saved(page);
});
