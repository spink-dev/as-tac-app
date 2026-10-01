import { openTab } from './workspace-helpers';
import { test, expect, type Page } from '@playwright/test';
import { createProject, type Phase } from '../src/core/projects/model';
import { execute } from '../src/core/projects/commands';
import { makeElement } from '../src/features/editor/geometry';
import { removePhase, removeTeam, saveElement, savePhase, swapPhases } from '../src/features/briefing/commands';

test('team/phase deletion and assignment batches preserve references and are reversible', () => {
    let project = createProject('Plan', 'benglen');
    const team = { id: crypto.randomUUID(), name: 'Alpha', shortLabel: 'A', colour: '#176b89' };
    const element = { ...makeElement(project.id, 'point', [[8.63, 47.36]], 'Tor'), teamId: team.id };
    project = execute(project, [{ kind: 'team', id: team.id, value: team }, { kind: 'element', id: element.id, value: element }]).project;
    const phase: Phase = { id: crypto.randomUUID(), title: 'Start', order: 0, notes: '', camera: null, visibleElementIds: [element.id] };
    project = execute(project, savePhase(project, phase)).project;
    expect(project.elements[0].phaseIds).toEqual([phase.id]);
    const withoutTeam = execute(project, removeTeam(project, team.id));
    expect(withoutTeam.project.elements[0].teamId).toBeUndefined();
    expect(execute(withoutTeam.project, withoutTeam.change.inverse).project).toEqual(project);
    const withoutPhase = execute(project, removePhase(project, phase.id));
    expect(withoutPhase.project.elements[0].phaseIds).toEqual([]);
    expect(execute(withoutPhase.project, withoutPhase.change.inverse).project).toEqual(project);
    const unassigned = execute(project, saveElement(project, { ...project.elements[0], phaseIds: [] })).project;
    expect(unassigned.phases[0].visibleElementIds).toEqual([]);
    const second = { ...phase, id: crypto.randomUUID(), order: 1, title: 'Ende', visibleElementIds: [] };
    project = execute(project, savePhase(project, second)).project;
    const swapped = execute(project, swapPhases(phase, second));
    expect(swapped.project.phases.map((item) => item.order)).toEqual([1, 0]);
    expect(execute(swapped.project, swapped.change.inverse).project).toEqual(project);
});

async function stored(page: Page) {
    return page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open('as-tac-projects');
            request.onsuccess = () => resolve(request.result);
        });
        const result = await new Promise<any[]>((resolve) => {
            const request = db.transaction('projects').objectStore('projects').getAll();
            request.onsuccess = () => resolve(request.result);
        });
        db.close();
        return result[0];
    });
}
async function saved(page: Page) {
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
}
async function prepare(page: Page) {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await expect(page.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await openTab(page, 'Projekt');
    await page.getByLabel('Name des neuen Projekts').fill('Briefing-Test');
    await openTab(page, 'Projekt');
    await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
    await saved(page);
    await openTab(page, 'Planung');
    await page.getByRole('group', { name: 'Zeichenwerkzeuge' }).getByRole('button', { name: 'Punkt', exact: true }).click();
    await page.locator('.maplibregl-canvas').click({ position: { x: 140, y: 260 } });
    await openTab(page, 'Planung');
    await page.getByLabel('Beschriftung', { exact: true }).fill('Eingang');
    await openTab(page, 'Planung');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await saved(page);
}
async function stroke(page: Page) {
    await openTab(page, 'Briefing');
    await page.getByRole('button', { name: 'Temporär zeichnen', exact: true }).click();
    const canvas = page.locator('.maplibregl-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 230, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 290, box.y + 370, { steps: 10 });
    await page.mouse.up();
    await openTab(page, 'Briefing');
    await expect(page.getByText('1 temporäre Markierungen', { exact: true })).toBeVisible();
}

test('teams, phases and camera persist; briefing filters locally and temporary strokes never autosave', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await prepare(page);
    await openTab(page, 'Planung');
    await page.getByLabel('Neues Team', { exact: true }).fill('Alpha');
    await openTab(page, 'Planung');
    await page.getByRole('button', { name: 'Team anlegen', exact: true }).click();
    await openTab(page, 'Planung');
    await page.getByLabel('Team zuordnen', { exact: true }).selectOption({ label: 'Alpha' });
    await openTab(page, 'Planung');
    await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    for (const title of ['Start', 'Ende']) {
        await openTab(page, 'Planung');
        await page.getByLabel('Neue Phase', { exact: true }).fill(title);
        await openTab(page, 'Planung');
        await page.getByRole('button', { name: 'Phase anlegen', exact: true }).click();
    }
    await page.locator('summary').filter({ hasText: /^Ende$/ }).click();
    const form = page.getByRole('form', { name: 'Phase bearbeiten: Ende' });
    await form.getByLabel('Phasennotizen', { exact: true }).fill('Abschluss am Ausgang');
    await form.getByLabel('Eingang', { exact: true }).uncheck();
    await form.getByRole('button', { name: 'Übernehmen', exact: true }).click();
    await saved(page);
    const before = await stored(page);
    expect(before.project.elements[0].teamId).toBe(before.project.teams[0].id);
    expect(before.project.phases[0].camera).not.toBeNull();
    await openTab(page, 'Briefing');
    await page.getByRole('button', { name: 'Briefing starten', exact: true }).click();
    await expect(page.getByRole('heading', { name: '1 / 2 · Start' })).toBeVisible();
    await expect(page.locator('.plan-label')).toHaveCount(1);
    await expect(page.locator('.plan-label')).toContainText('[ALPHA]');
    await expect(page.getByLabel('Projekt öffnen')).toBeDisabled();
    await stroke(page);
    await openTab(page, 'Briefing');
    await page.getByRole('button', { name: 'Nächste Phase', exact: true }).click();
    await expect(page.getByRole('heading', { name: '2 / 2 · Ende' })).toBeVisible();
    await expect(page.locator('.plan-label')).toHaveCount(0);
    await expect(page.getByText('0 temporäre Markierungen', { exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('heading', { name: '1 / 2 · Start' })).toBeVisible();
    await stroke(page);
    await openTab(page, 'Briefing');
    await page.getByRole('button', { name: 'Briefing beenden', exact: true }).click();
    expect(await stored(page)).toEqual(before);
    await expect(page.locator('.plan-label')).toHaveCount(1);
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await openTab(page, 'Projekt');
    await openTab(page, 'Briefing');
    await page.getByRole('button', { name: 'Briefing starten', exact: true }).click();
    await expect(page.getByRole('heading', { name: '1 / 2 · Start' })).toBeVisible();
    await stroke(page);
    await openTab(page, 'Briefing');
    await page.getByRole('button', { name: 'In Plan übernehmen', exact: true }).click();
    await saved(page);
    expect((await stored(page)).project.elements).toHaveLength(2);
    await expect(page.locator('.plan-label')).toHaveCount(2);
    await page.screenshot({ path: 'test-results/briefing-mobile.png', fullPage: true });
    await openTab(page, 'Briefing');
    await page.getByRole('button', { name: 'Briefing beenden', exact: true }).click();
    await openTab(page, 'Projekt');
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
    await saved(page);
    expect((await stored(page)).project.elements).toHaveLength(1);
    expect((await stored(page)).project.phases[0].visibleElementIds).toHaveLength(1);
    expect(errors).toEqual([]);
});
