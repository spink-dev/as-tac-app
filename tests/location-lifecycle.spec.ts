import { test, expect } from '@playwright/test';

test('foreground GPS restarts once, ignores old callbacks and preserves explicit stop/denial', async ({ page }) => {
    await page.addInitScript(() => {
        const callbacks: { success: PositionCallback; error: PositionErrorCallback | null }[] = [];
        const cleared: number[] = [];
        Object.defineProperty(navigator, 'geolocation', { value: {
            watchPosition(success: PositionCallback, error: PositionErrorCallback | null) {
                callbacks.push({ success, error });
                return callbacks.length;
            },
            clearWatch(id: number) {
                cleared.push(id);
            },
        } });
        (window as any).gpsTest = {
            callbacks, cleared,
            fix(index: number, accuracy = 12, offset = 0) {
                callbacks[index].success({ coords: { latitude: 52.38, longitude: 11.82, accuracy }, timestamp: Date.now() + offset } as GeolocationPosition);
            },
            visibility(value: string) {
                Object.defineProperty(document, 'visibilityState', { configurable: true, value });
                document.dispatchEvent(new Event('visibilitychange'));
            },
        };
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Meine Position', exact: true }).click();
    await page.evaluate(() => (window as any).gpsTest.fix(0));
    await expect(page.locator('.coordinates')).toContainText('± 12 m');
    await page.evaluate(() => (window as any).gpsTest.visibility('hidden'));
    await expect(page.getByText(/GPS im Hintergrund pausiert/)).toBeVisible();
    await expect(page.locator('.coordinates')).toContainText('VERALTET');
    await page.evaluate(() => {
        (window as any).gpsTest.visibility('visible');
        window.dispatchEvent(new Event('pageshow'));
    });
    expect(await page.evaluate(() => (window as any).gpsTest.callbacks.length)).toBe(2);
    await expect(page.locator('.coordinates')).toContainText('VERALTET');
    await page.evaluate(() => (window as any).gpsTest.fix(0, 999));
    await expect(page.locator('.coordinates')).toContainText('± 12 m');
    await page.evaluate(() => (window as any).gpsTest.fix(1, 80));
    await expect(page.getByText(/Ungenaue Position: über 50 m/)).toBeVisible();
    await expect(page.locator('.coordinates')).not.toContainText('VERALTET');
    await page.evaluate(() => (window as any).gpsTest.fix(1, 15, -10000));
    await expect(page.locator('.coordinates')).toContainText('± 80 m');
    await page.evaluate(() => (window as any).gpsTest.fix(1, 15, 60000));
    await expect(page.getByText('Ungültiger GPS-Fix.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'GPS stoppen', exact: true }).click();
    await page.evaluate(() => {
        (window as any).gpsTest.fix(1, 25);
        (window as any).gpsTest.visibility('hidden');
        (window as any).gpsTest.visibility('visible');
    });
    await expect(page.locator('.coordinates')).toContainText('± 80 m');
    expect(await page.evaluate(() => (window as any).gpsTest.callbacks.length)).toBe(2);
    await page.getByRole('button', { name: 'Meine Position', exact: true }).click();
    await page.evaluate(() => (window as any).gpsTest.callbacks[2].error({ code: 1 }));
    await expect(page.getByText(/Standortfreigabe verweigert/)).toBeVisible();
    await page.evaluate(() => {
        (window as any).gpsTest.visibility('hidden');
        (window as any).gpsTest.visibility('visible');
    });
    expect(await page.evaluate(() => (window as any).gpsTest.callbacks.length)).toBe(3);
    expect(await page.evaluate(() => (window as any).gpsTest.cleared)).toEqual([1, 2, 3]);
});
