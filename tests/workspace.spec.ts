import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { openTab, closePanel } from './workspace-helpers';
import { test, expect } from '@playwright/test';
import { eventProject, events } from '../src/features/catalog/catalog';
import { duplicateProject, validateProject, createProject } from '../src/core/projects/model';
import { execute } from '../src/core/projects/commands';

test('event variants share physical source IDs but isolate geometry, labels and layer copies', () => {
    const variants = events.map((event) => eventProject(event.id));
    variants.forEach((project) => expect(() => validateProject(project)).not.toThrow());
    const de = variants.find((project) => project.workspace?.eventId === 'de')!;
    const other = variants.find((project) => project.workspace?.eventId !== 'de')!;
    const source = 'mahlwinkel:poi:613';
    expect(de.elements.find((element) => element.sourceId === source)?.geometry).toEqual(other.elements.find((element) => element.sourceId === source)?.geometry);
    expect(de.elements.find((element) => element.sourceId === source)?.label).not.toBe(other.elements.find((element) => element.sourceId === source)?.label);
    const copy = duplicateProject(de, 'Eigene Ausgabe');
    expect(copy.workspace?.layers[0].id).not.toBe(de.workspace?.layers[0].id);
    expect(copy.elements[0].layerId).toBe(copy.workspace?.layers[0].id);
    copy.elements[0].label = 'Eigene Grenze';
    expect(de.elements[0].label).toBe('Spielfeldgrenze');
    const broken = structuredClone(copy);
    broken.workspace!.layers = [];
    expect(() => validateProject(broken)).toThrow();
    const old = createProject('Altbestand', 'benglen');
    const upgrade = execute(old, [{ kind: 'project', schemaVersion: 2, workspace: copy.workspace }]);
    expect(execute(upgrade.project, upgrade.change.inverse).project).toEqual(old);
});

test('map-first mobile workflow installs offline event, duplicates, draws a new layer and exports it', async ({ page, context, browser }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.workspace-sheet')).toBeHidden();
    await page.getByRole('tab', { name: 'Karten', exact: true }).click();
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await page.getByLabel('Event', { exact: true }).selectOption('de');
    await page.getByRole('button', { name: 'Eventkarte offline speichern' }).click();
    await expect(page.getByText(/Eventkarte auf diesem Gerät gespeichert/)).toBeVisible();
    await page.getByRole('tab', { name: 'Projekt', exact: true }).click();
    await expect(page.getByLabel('Projektname', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Bearbeitbare Kopie erstellen', exact: true }).click();
    await expect(page.getByLabel('Projektname', { exact: true })).toBeEnabled();
    await page.getByRole('tab', { name: 'Planung', exact: true }).click();
    await page.locator('.layer-panel summary').click();
    await page.getByLabel('Neue Ebene', { exact: true }).fill('Eigene Wege');
    await page.getByRole('button', { name: 'Ebene hinzufügen' }).click();
    await page.getByRole('group', { name: 'Zeichenwerkzeuge' }).getByRole('button', { name: 'Punkt', exact: true }).click();
    await expect(page.locator('.workspace-sheet')).toBeHidden();
    await page.locator('.maplibregl-canvas').click({ position: { x: 190, y: 250 } });
    await expect(page.getByLabel('Beschriftung', { exact: true })).toBeVisible();
    await page.getByLabel('Beschriftung', { exact: true }).fill('Treffpunkt');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    if (!await page.getByLabel('Eigene Wege', { exact: true }).isVisible()) {
        await page.locator('.layer-panel summary').click();
    }
    await page.getByLabel('Eigene Wege', { exact: true }).uncheck();
    await expect(page.locator('.plan-label').filter({ hasText: 'Treffpunkt' })).toHaveCount(0);
    await page.getByLabel('Eigene Wege', { exact: true }).check();
    await expect(page.locator('.plan-label').filter({ hasText: 'Treffpunkt' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Sperren Eigene Wege', exact: true }).click();
    await expect(page.getByLabel('Beschriftung', { exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'Projekt', exact: true }).click();
    await page.getByText('Kartenstudio', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Diese Ausgabe veröffentlichen' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Vollständiges Projekt sichern (.astac.zip)' })).toBeEnabled();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Vollständiges Projekt sichern (.astac.zip)' }).click();
    const exportedFile = await download;
    expect(exportedFile.suggestedFilename()).toMatch(/\.astac.zip$/);
    const bytes = readFileSync((await exportedFile.path())!);
    const document = JSON.parse(new TextDecoder().decode(unzipSync(bytes)['project.json']));
    expect(document.schemaVersion).toBe(2);
    expect(document.workspace.layers.at(-1).locked).toBe(true);
    expect(document.elements.find((item: any) => item.label === 'Treffpunkt').layerId).toBe(document.workspace.layers.at(-1).id);
    const second = await browser.newContext();
    const other = await second.newPage();
    await other.goto('/');
    await openTab(other, 'Karten');
    await expect(other.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await second.setOffline(true);
    await openTab(other, 'Projekt');
    await other.getByLabel('Projektpaket öffnen (.astac.zip)').setInputFiles({ name: 'event.astac.zip', mimeType: 'application/zip', buffer: bytes });
    await expect(other.getByText('Projekt und Karte gemeinsam gespeichert · schreibgeschützte Kopie geöffnet.')).toBeVisible();
    await openTab(other, 'Orientierung');
    await other.locator('.layer-panel summary').click();
    await expect(other.getByLabel('Eigene Wege', { exact: true })).toBeChecked();
    await expect(other.getByLabel('Deckkraft Eigene Wege', { exact: true })).toBeEnabled();
    await second.close();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.workspace-title')).toContainText('Dark Emergency');
    await page.screenshot({ path: 'test-results/workspace-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('tab', { name: 'Planung', exact: true }).click();
    await page.locator('.layer-panel summary').click();
    await expect(page.getByRole('button', { name: 'Entsperren Eigene Wege', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/workspace-desktop.png' });
    expect(errors).toEqual([]);
});

test('overlapping object picker and pending attribute guard keep drawing and inspection distinct', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await page.getByLabel('Name des neuen Projekts').fill('Ebenentest');
    await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toBeVisible();
    await openTab(page, 'Planung');
    await page.getByRole('group', { name: 'Zeichenwerkzeuge' }).getByRole('button', { name: 'Fläche', exact: true }).click();
    for (const [x, y] of [[100, 180], [290, 180], [290, 330], [100, 330]]) {
        await page.locator('.maplibregl-canvas').click({ position: { x, y } });
    }
    await page.getByRole('button', { name: 'Fertig', exact: true }).click();
    await page.getByRole('group', { name: 'Zeichenwerkzeuge' }).getByRole('button', { name: 'Punkt', exact: true }).click();
    await page.locator('.maplibregl-canvas').click({ position: { x: 190, y: 250 } });
    await page.getByLabel('Beschriftung', { exact: true }).fill('Unübernommen');
    await expect(page.getByRole('tab', { name: 'Projekt', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Angaben verwerfen', exact: true }).click();
    await expect(page.getByLabel('Beschriftung', { exact: true })).toHaveValue('Punkt');
    await page.getByRole('group', { name: 'Zeichenwerkzeuge' }).getByRole('button', { name: 'Auswahl', exact: true }).click();
    await closePanel(page);
    await page.locator('.maplibregl-canvas').click({ position: { x: 190, y: 250 } });
    await expect(page.getByRole('group', { name: 'Überlagerte Objekte' }).getByRole('button')).toHaveCount(2);
    await page.getByRole('group', { name: 'Überlagerte Objekte' }).getByRole('button', { name: 'Fläche', exact: true }).click();
    await expect(page.getByLabel('Beschriftung', { exact: true })).toHaveValue('Fläche');
});

test('audited event geometry fits the terrain package and safe areas remain ground underneath', () => {
    const manifest = JSON.parse(readFileSync('public/maps/mahlwinkel.json', 'utf8'));
    const config = JSON.parse(readFileSync('src/config/maps.json', 'utf8')).find((area: any) => area.id === 'mahlwinkel');
    expect(manifest.bounds).toEqual(config.bounds);
    const [west, south, east, north] = manifest.bounds;
    for (const event of events) {
        const project = eventProject(event.id);
        for (const element of project.elements) {
            const geometry = element.geometry;
            const points = geometry.type === 'Polygon' ? geometry.coordinates.flat()
                : geometry.type === 'LineString' ? geometry.coordinates
                : geometry.type === 'Point' ? [geometry.coordinates] : [geometry.center];
            for (const [lon, lat] of points) {
                expect(lon, `${event.id} ${element.sourceId}`).toBeGreaterThanOrEqual(west);
                expect(lon).toBeLessThanOrEqual(east);
                expect(lat).toBeGreaterThanOrEqual(south);
                expect(lat).toBeLessThanOrEqual(north);
            }
            if (geometry.type === 'Polygon') {
                const ring = geometry.coordinates[0];
                expect(ring.length).toBeGreaterThanOrEqual(4);
                expect(ring[0]).toEqual(ring.at(-1));
                // Non-adjacent segments must not cross (source validation alone allows bow ties).
                const cross = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
                for (let i = 0; i < ring.length - 1; i++) {
                    for (let j = i + 2; j < ring.length - 1; j++) {
                        if (i === 0 && j === ring.length - 2) {
                            continue;
                        }
                        const [a, b, c, d] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
                        expect(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0,
                            `${event.id} ${element.sourceId} crossing edges ${i}/${j}`).toBe(false);
                    }
                }
            }
        }
    }
    const project = eventProject('de');
    const layers = project.workspace!.layers;
    const safeLayer = layers.find((layer) => layer.name === 'Safe Zones')!;
    expect(layers.indexOf(safeLayer)).toBeGreaterThan(layers.findIndex((layer) => layer.name === 'Spielfeld'));
    const safeAreas = project.elements.filter((element) => element.layerId === safeLayer.id);
    expect(safeAreas).toHaveLength(5);
    expect(safeAreas.map((element) => element.label)).toContain('Miliz HQ · Safe Zone');
    for (const area of safeAreas) {
        expect(area.geometry.type).toBe('Polygon');
        const ground = project.elements.find((element) => element.sourceId === area.sourceId!.replace(':zone:', ':site:'))!;
        expect(ground.geometry).toEqual(area.geometry);
        expect(ground.layerId).not.toBe(area.layerId);
    }
    // Miliz was a point only in the previous edition; its known location must be inside the new polygon.
    const miliz = safeAreas.find((element) => element.sourceId?.endsWith(':miliz-safe'))!;
    expect(miliz.geometry.type).toBe('Polygon');
    if (miliz.geometry.type === 'Polygon') {
        const ring = miliz.geometry.coordinates[0];
        const [x, y] = [11.82435, 52.379664];
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [a, b] = [ring[i], ring[j]];
            if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) {
                inside = !inside;
            }
        }
        expect(inside).toBe(true);
    }
    const m24 = eventProject('m24');
    const civilian = m24.elements.find((element) => element.sourceId?.endsWith(':zivile-zone'))!;
    expect(m24.workspace!.layers.find((layer) => layer.id === civilian.layerId)?.name).toBe('Zonen');
    expect(eventProject('opt').elements.find((element) => element.sourceId?.endsWith(':sperrgebiet'))?.label).toBe('Militärisches Sperrgebiet');
});
