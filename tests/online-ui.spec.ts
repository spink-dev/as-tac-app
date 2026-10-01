import { test, expect } from '@playwright/test';
import { createProject } from '../src/core/projects/model';

test('online panel stays local without configuration; configured login and membership flow', async ({ page }) => {
    const configured = process.env.AST_ONLINE_UI_TEST === '1';
    const uid = '11111111-1111-4111-8111-111111111111';
    const member = '22222222-2222-4222-8222-222222222222';
    const project = createProject('Online Test', 'benglen');
    let created = false;
    let access: string | null = null;
    if (configured) {
        await page.route('https://as-tac-test.invalid/**', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const headers = { 'access-control-allow-origin': '*' };
            if (url.pathname === '/auth/v1/token') {
                expect(request.postDataJSON()).toMatchObject({ email: 'owner@example.test', password: 'test-only-password' });
                await route.fulfill({ headers, json: { access_token: 'test-only-token', token_type: 'bearer', refresh_token: 'test-only-refresh', expires_in: 3600, user: { id: uid, email: 'owner@example.test', aud: 'authenticated' } } });
            } else if (url.pathname === '/rest/v1/rpc/ast_create_project') {
                expect(request.postDataJSON()).toMatchObject({ p_name: 'Online Test', p_map: 'benglen' });
                created = true;
                await route.fulfill({ headers, json: {} });
            } else if (url.pathname === '/rest/v1/ast_projects') {
                await route.fulfill({ headers, json: created ? [{ id: project.id, document: project, server_seq: 0, versions: { project: 1 } }] : [] });
            } else if (url.pathname === '/rest/v1/ast_memberships') {
                await route.fulfill({ headers, json: [{ user_id: uid, role: 'owner' }, ...(access ? [{ user_id: member, role: access }] : [])] });
            } else if (url.pathname === '/rest/v1/rpc/ast_set_member') {
                const body = request.postDataJSON();
                expect(body).toMatchObject({ p_project: project.id, p_user: member });
                access = body.p_role;
                await route.fulfill({ headers, json: null });
            } else if (url.pathname === '/auth/v1/logout') {
                await route.fulfill({ headers, status: 204 });
            } else {
                await route.abort();
            }
        });
    }
    await page.goto('/');
    await page.getByText('Online-Projekte & Mitglieder', { exact: true }).click();
    if (!configured) {
        await expect(page.getByText(/Online-Zusammenarbeit ist hier noch nicht eingerichtet/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toHaveCount(0);
        return;
    }
    await page.getByLabel('E-Mail', { exact: true }).fill('owner@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('test-only-password');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByText(/Eigene Konto-ID/)).toBeVisible();
    await page.getByLabel('Name des Online-Projekts', { exact: true }).fill('Online Test');
    await page.getByRole('button', { name: 'Leeres Online-Projekt erstellen', exact: true }).click();
    await expect(page.getByText('Online-Projekt auf dem Server erstellt.')).toBeVisible();
    await page.getByLabel('Online-Projekt', { exact: true }).selectOption(project.id);
    await page.getByLabel('Konto-ID des Mitglieds', { exact: true }).fill(member);
    await page.getByRole('button', { name: 'Zugriff speichern', exact: true }).click();
    await expect(page.getByText('Zugriff auf dem Server gespeichert.')).toBeVisible();
    expect(access).toBe('viewer');
    await page.getByRole('button', { name: 'Zugriff entziehen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Zugriff entziehen', exact: true })).toHaveCount(0);
    expect(access).toBeNull();
    await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
    await expect(page.getByText(/Eigene Konto-ID/)).toHaveCount(0);
});
