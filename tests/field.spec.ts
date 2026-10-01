import { test, expect } from '@playwright/test';
import { appendTrack, averageReference, calibration, correctedFix, trackGeoJSON } from '../src/features/field/navigation';
import { presentation, labelPosition, patternImage } from '../src/features/editor/presentation';
import { eventProject } from '../src/features/catalog/catalog';
import { makeElement } from '../src/features/editor/geometry';
import { validateProject } from '../src/core/projects/model';
import { openTab, closePanel } from './workspace-helpers';

test('presentation keeps holes, safe patterns and boundary label policy; optional styles validate', () => {
    const project = eventProject('de');
    expect(presentation(project.elements[0]).labelMode).toBe('hidden');
    project.elements[0].style.labelMode = 'auto';
    expect(presentation(project.elements[0]).labelMode).toBe('hidden');
    const safe = project.elements.find((e) => e.sourceId?.includes(':zone:'))!;
    expect(presentation(safe)).toMatchObject({ symbol: 'shield', pattern: 'hatch' });
    const polygon = makeElement(
        crypto.randomUUID(),
        'polygon',
        [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ],
        'Hole',
    );
    polygon.geometry = {
        type: 'Polygon',
        coordinates: [
            [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
            ],
            [
                [3, 3],
                [7, 3],
                [7, 7],
                [3, 7],
                [3, 3],
            ],
        ],
    };
    expect(labelPosition(polygon)).toEqual([1.5, 5]);
    const image = patternImage('hatch', false);
    expect(image.data[3]).toBeGreaterThan(0);
    expect(image.data[(7 * 16 + 1) * 4 + 3]).toBeGreaterThan(0); // rising diagonal
    safe.style = { ...safe.style, symbol: 'shield', pattern: 'cross', labelMode: 'always' };
    expect(() => validateProject(project)).not.toThrow();
    (safe.style as any).pattern = 'external-url';
    expect(() => validateProject(project)).toThrow();
});

test('GPS traces reject poor fixes and split outages; calibration never reduces reported accuracy', () => {
    const now = Date.now();
    const fix = { longitude: 11.82, latitude: 52.38, accuracy: 8, timestamp: now - 10000, speed: 1 };
    let track = appendTrack([], fix, false);
    expect(appendTrack(track, { ...fix, longitude: 11.821, accuracy: 60, timestamp: now - 9000 }, false)).toBe(track);
    track = appendTrack(track, { ...fix, longitude: 11.8202, timestamp: now - 8000 }, false);
    track = appendTrack(track, { ...fix, longitude: 11.821, timestamp: now - 1000 }, true);
    expect(track).toHaveLength(2);
    expect(trackGeoJSON(track).features).toHaveLength(1); // Never connect over gap.
    const samples = Array.from({ length: 5 }, (_, i) => ({ ...fix, timestamp: now - 4000 + i * 1000 }));
    const ref = averageReference([11.8201, 52.3801], samples);
    const corrected = correctedFix({ ...fix, timestamp: now }, [ref], true, now)!;
    expect(corrected.longitude).toBeCloseTo(11.8201, 7);
    expect(corrected.accuracy).toBeGreaterThanOrEqual(fix.accuracy);
    expect(correctedFix(fix, [ref], true, now + 600001)).toBe(fix);
    expect(correctedFix({ ...fix, latitude: 53 }, [ref], true, now)?.latitude).toBe(53);
    expect(calibration([ref, { ...ref, target: [11.8211, 52.3801] }])?.valid).toBe(false);
    expect(() => averageReference([11.84, 52.38], samples)).toThrow();
    expect(() => averageReference([11.8201, 52.38], samples.slice(0, 4))).toThrow();
});

test('field tools require opt-in, record locally, pause in background and gate calibration', async ({ page }) => {
    await page.addInitScript(() => {
        let success: PositionCallback;
        Object.defineProperty(navigator, 'geolocation', {
            value: {
                watchPosition: (callback: PositionCallback) => {
                    success = callback;
                    return 1;
                },
                clearWatch: () => {},
            },
        });
        (window as any).emitFix = (longitude: number, timestamp: number, accuracy = 6) =>
            success({ coords: { longitude, latitude: 52.38, accuracy, speed: 1.2 }, timestamp } as GeolocationPosition);
        class Motion extends Event {
            static requests = 0;
            static async requestPermission() {
                Motion.requests++;
                return 'granted';
            }
        }
        Object.defineProperty(window, 'DeviceMotionEvent', { value: Motion, configurable: true });
    });
    await page.goto('/');
    await openTab(page, 'Projekt');
    await page.getByLabel('Name des neuen Projekts').fill('Geländeaufnahme');
    await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toBeVisible();
    await openTab(page, 'Orientierung');
    await page.getByRole('button', { name: 'Meine Position', exact: true }).click();
    const base = Date.now() - 12000;
    await page.evaluate((time) => (window as any).emitFix(11.82, time), base);
    await expect(page.getByLabel('GPS-Geschwindigkeit')).toContainText('4.3 km/h');
    await page.getByText('Bewegungssensoren', { exact: true }).click();
    expect(await page.evaluate(() => (DeviceMotionEvent as any).requests)).toBe(0);
    await page.getByRole('button', { name: 'Sensoren freigeben' }).click();
    expect(await page.evaluate(() => (DeviceMotionEvent as any).requests)).toBe(1);
    await page.evaluate(() => {
        const event = new Event('devicemotion');
        Object.defineProperty(event, 'acceleration', { value: { x: 0, y: 0, z: 0 } });
        window.dispatchEvent(event);
    });
    await expect(page.getByText('Gerät momentan ruhig')).toBeVisible();
    await page.getByText('Pfad aufnehmen', { exact: true }).click();
    await page.getByRole('button', { name: 'Pfadaufnahme starten' }).click();
    await expect(page.getByRole('tab', { name: 'Karten', exact: true })).toBeDisabled();
    await page.evaluate((time) => (window as any).emitFix(11.82015, time), base + 2000);
    await expect(page.locator('.field-tools output').filter({ hasText: /2 Messpunkte/ })).toBeVisible();
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByText(/2 Messpunkte.*Pausiert/)).toBeVisible();
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Pfad als GeoJSON speichern' }).click();
    expect((await download).suggestedFilename()).toBe('as-tac-pfad.geojson');
    await page.getByRole('button', { name: 'Als Planlinien übernehmen' }).click();
    await expect(page.getByText('Planlinien übernommen. Projekt-Speicherstatus beachten.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Karten', exact: true })).toBeEnabled();
    await page.getByText('Standort abgleichen · 0/3 Punkte').click();
    await page.evaluate(() => (window as any).emitFix(11.82015, Date.now() - 6000));
    await page.getByRole('button', { name: 'Standort auf Karte wählen' }).click();
    await closePanel(page);
    const box = (await page.locator('.maplibregl-canvas').boundingBox())!;
    await page.locator('.maplibregl-canvas').click({ position: { x: box.width / 2, y: box.height / 2 } });
    await openTab(page, 'Orientierung');
    await expect(page.getByRole('button', { name: /Kontrollpunkt übernehmen/ })).toBeDisabled();
    const button = page.getByRole('button', { name: /Kontrollpunkt übernehmen/ });
    const initial = Number((await button.textContent())!.match(/\((\d+)\/5\)/)![1]);
    for (let i = 0; i < 5; i++) {
        await page.evaluate((offset) => (window as any).emitFix(11.82015, Date.now() - 4000 + offset * 1000), i);
        await expect(button).toHaveText(`Kontrollpunkt übernehmen (${initial + i + 1}/5)`);
    }
    await page.getByRole('button', { name: /Kontrollpunkt übernehmen/ }).click();
    await expect(page.getByText('Standort abgleichen · 1/3 Punkte')).toBeVisible();
    await page.getByRole('button', { name: 'Versatz für diese Sitzung verwenden' }).click();
    await expect(page.getByText(/Lokaler Versatz aktiv · ursprüngliches GPS/)).toBeVisible();
    await page.getByRole('button', { name: 'Abgleich zurücksetzen' }).click();
    await expect(page.getByText('Plan lokal gespeichert', { exact: true })).toBeVisible();
    await page.reload();
    await openTab(page, 'Orientierung');
    await expect(page.getByText('Aufgenommener Pfad 1', { exact: true }).first()).toBeVisible();
});

test('map symbols, style editing and keyboard drawing survive a reload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await openTab(page, 'Karten');
    await page.getByLabel('Event', { exact: true }).selectOption('de');
    await page.getByRole('button', { name: 'Eventkarte offline speichern' }).click();
    await expect(page.getByText(/Eventkarte auf diesem Gerät gespeichert/)).toBeVisible();
    await expect(page.locator('.plan-label').filter({ hasText: 'Spielfeldgrenze' })).toHaveCount(0);
    await expect(page.locator('.plan-label svg').first()).toBeAttached();
    await openTab(page, 'Projekt');
    await page.getByRole('button', { name: 'Bearbeitbare Kopie erstellen', exact: true }).click();
    await openTab(page, 'Planung');
    await closePanel(page);
    await page.keyboard.press('p');
    await page.locator('.maplibregl-canvas').click({ position: { x: 190, y: 230 } });
    await page.getByLabel('Beschriftung', { exact: true }).fill('Sammelpunkt');
    await page.getByLabel('Symbol', { exact: true }).selectOption('aid');
    await page.getByLabel('Beschriftung anzeigen').selectOption('always');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await expect(page.getByText('Plan lokal gespeichert', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.plan-label').filter({ hasText: 'Sammelpunkt' }).locator('svg')).toHaveCount(1);
    await page.screenshot({ path: 'test-results/field-symbols-mobile.png' });
    await expect(page.locator('.map-error')).toHaveCount(0);
    expect(errors).toEqual([]);
});
