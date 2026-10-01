import { expect, type Page } from '@playwright/test';
export async function openTab(page: Page, name: 'Orientierung' | 'Planung' | 'Briefing' | 'Karten' | 'Projekt') {
    const tab = page.getByRole('tab', { name, exact: true });
    if (await tab.getAttribute('aria-selected') !== 'true' || !await page.locator('.workspace-sheet').isVisible()) {
        await tab.click();
    }
    await expect(page.locator('.workspace-sheet')).toBeVisible();
}
export async function closePanel(page: Page) {
    const close = page.locator('.sheet-heading').getByRole('button', { name: 'Panel schliessen' });
    if (await close.isVisible()) {
        await close.click();
    }
}
