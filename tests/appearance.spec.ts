import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { openTab, closePanel } from './workspace-helpers';

test('appearance keeps the live map and draft, then survives an offline cold start', async ({ page, context, browserName }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: 'light' });
    // WebKit 1.63 kills service-worker requests before dispatch when setOffline(true).
    // Use an actual unavailable origin instead: https://github.com/microsoft/playwright/issues/42775
    const origin = browserName === 'webkit' ? await stoppableOrigin() : null;
    try {
        await page.goto(origin?.url ?? '/');
        await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
        await openTab(page, 'Karten');
        await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
        await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
        await openTab(page, 'Projekt');
        await page.getByLabel('Name des neuen Projekts').fill('Nachtübung');
        await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
        await openTab(page, 'Planung');
        await page.getByRole('group', { name: 'Zeichenwerkzeuge' }).getByRole('button', { name: 'Linie', exact: true }).click();
        await page.locator('.maplibregl-canvas').click({ position: { x: 170, y: 210 } });
        const originalCanvas = await page.locator('.maplibregl-canvas').elementHandle();
        await page.locator('.appearance summary').click();
        await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        expect(await originalCanvas!.evaluate((node) => node.isConnected)).toBe(true);
        await page.locator('.maplibregl-canvas').click({ position: { x: 210, y: 260 } });
        await openTab(page, 'Planung');
        await page.getByRole('button', { name: 'Zeichnung abschliessen', exact: true }).click();
        await page.getByLabel('Beschriftung', { exact: true }).fill('Nachtweg');
        const storedColor = await page.getByLabel('Farbe', { exact: true }).inputValue();
        await page.locator('.appearance summary').click();
        await page.getByRole('button', { name: 'Rotlicht', exact: true }).click();
        await expect(page.getByLabel('Beschriftung', { exact: true })).toHaveValue('Nachtweg');
        await expect(page.getByLabel('Farbe', { exact: true })).toHaveValue(storedColor);
        await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
        await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
        await closePanel(page);
        await page.screenshot({ path: 'test-results/appearance-red-mobile.png' });
        if (origin) {
            await origin.stop();
            await expect(fetch(origin.url)).rejects.toThrow();
        } else {
            await context.setOffline(true);
        }
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'red');
        await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#100505');
        await expect(page.locator('.plan-label').filter({ hasText: 'Nachtweg' })).toHaveCount(1);
        await openTab(page, 'Planung');
        await page.screenshot({ path: 'test-results/appearance-red-panel.png' });
        await page.locator('.appearance summary').click();
        await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
        await nextMapFrame(page);
        await page.screenshot({ path: 'test-results/appearance-dark-mobile.png' });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: 'test-results/appearance-dark-desktop.png' });
        await page.locator('.appearance summary').click();
        await page.getByRole('button', { name: 'Tag', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        await nextMapFrame(page);
        await page.screenshot({ path: 'test-results/appearance-light-desktop.png' });
        expect(errors).toEqual([]);
    } finally {
        await origin?.stop();
    }
});

test('saved red appearance applies before React loads and storage failures remain usable', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    await context.addInitScript(() => localStorage.setItem('as-tac.appearance', 'red'));
    const page = await context.newPage();
    // Stop the React island loading: appearance is still applied by the synchronous head script.
    await page.route('**/_astro/*.js', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'red');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(27, 9, 8)');
    await context.close();
    const restricted = await browser.newContext({ colorScheme: 'dark' });
    await restricted.addInitScript(() => {
        Storage.prototype.getItem = () => {
            throw new DOMException('Blocked', 'SecurityError');
        };
        Storage.prototype.setItem = () => {
            throw new DOMException('Blocked', 'SecurityError');
        };
    });
    const other = await restricted.newPage();
    await other.goto('/');
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
    await other.locator('.appearance summary').click();
    await other.getByRole('button', { name: 'Rotlicht', exact: true }).click();
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'red');
    await restricted.close();
});

async function stoppableOrigin() {
    const root = resolve('dist');
    const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.json': 'application/json',
        '.geojson': 'application/json',
        '.webmanifest': 'application/manifest+json',
    };
    const server = createServer(async (request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        try {
            if (!path.startsWith(root + '/')) {
                throw new Error('Outside fixture root');
            }
            const body = await readFile(path);
            response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
            response.end(body);
        } catch {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address() as { port: number };
    return {
        url: `http://127.0.0.1:${address.port}/`,
        stop: async () => {
            if (server.listening) {
                await new Promise<void>((done) => {
                    server.close(() => done());
                    server.closeAllConnections();
                });
            }
        },
    };
}

async function nextMapFrame(page: Page) {
    // MapLibre paints WebGL on its next animation frame after the React theme commit.
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}
