import { openTab } from './workspace-helpers';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createProject, duplicateProject, validateProject, type PlanElement, type Project } from '../src/core/projects/model';
import { execute } from '../src/core/projects/commands';

function fixture(): Project {
    const project = createProject('Benglen', 'benglen');
    const team = { id: crypto.randomUUID(), name: 'Alpha', shortLabel: 'A', colour: '#253d32' };
    const phaseId = crypto.randomUUID();
    const element: PlanElement = { id: crypto.randomUUID(), projectId: project.id, type: 'circle', geometry: { type: 'Circle', center: [8.63, 47.36], radiusMeters: 25 }, label: 'Treffpunkt', notes: '', teamId: team.id, phaseIds: [phaseId], style: { colour: '#253d32', width: 2, opacity: 1 }, version: 1 };
    project.teams.push(team);
    project.elements.push(element);
    project.phases.push({ id: phaseId, order: 0, title: 'Start', notes: '', camera: { center: [8.63, 47.36], zoom: 15, bearing: 0, pitch: 0 }, visibleElementIds: [element.id] });
    return project;
}

test('bounded WGS84 schema rejects invalid coordinates, references, sensor fields and future formats', () => {
    const project = fixture();
    expect(() => validateProject(project)).not.toThrow();
    for (const change of [
        (p: any) => {
            p.elements[0].geometry.center = [181, 47];
        },
        (p: any) => {
            p.elements[0].geometry.center = [8, NaN];
        },
        (p: any) => {
            p.elements[0].geometry.radiusMeters = -1;
        },
        (p: any) => {
            p.elements[0].phaseIds = [crypto.randomUUID()];
        },
        (p: any) => {
            p.phases[0].visibleElementIds = [crypto.randomUUID()];
        },
        (p: any) => {
            p.elements[0].notes = 'a'.repeat(10_001);
        },
        (p: any) => {
            p.elements[0].type = 'line';
        },
        (p: any) => {
            p.elements[0].geometry = { type: 'Circle', center: [8, 47], radiusMeters: Infinity };
        },
        (p: any) => {
            p.gps = { latitude: 47 };
        },
        (p: any) => {
            p.schemaVersion = 99;
        },
    ]) {
        const invalid = structuredClone(project);
        change(invalid);
        expect(() => validateProject(invalid)).toThrow();
    }
    const polygon = structuredClone(project);
    polygon.elements[0].type = 'polygon';
    polygon.elements[0].geometry = { type: 'Polygon', coordinates: [[[8, 47], [8.1, 47], [8.1, 47.1], [8, 47]]] };
    expect(() => validateProject(polygon)).not.toThrow();
    polygon.elements[0].geometry.coordinates[0].pop();
    expect(() => validateProject(polygon)).toThrow();
});

test('commands are atomic and reversible, duplicate remaps every internal reference', () => {
    const project = fixture();
    const second = { ...project.elements[0], id: crypto.randomUUID() };
    project.elements.push(second);
    expect(() => execute(project, [{ kind: 'team', id: project.teams[0].id, value: null }])).toThrow();
    const changed = execute(project, [
        { kind: 'element', id: project.elements[0].id, value: null },
        { kind: 'phase', id: project.phases[0].id, value: { ...project.phases[0], visibleElementIds: [] } },
        { kind: 'project', name: 'Neue Planung', mapPackageId: 'mahlwinkel' },
    ]);
    expect(execute(changed.project, changed.change.inverse).project).toEqual(project);
    expect(execute(project, changed.change.forward).project).toEqual(changed.project);
    const copy = duplicateProject(project, 'Kopie');
    expect(copy.id).not.toBe(project.id);
    expect(copy.elements[0].projectId).toBe(copy.id);
    expect(copy.elements[0].teamId).toBe(copy.teams[0].id);
    expect(copy.elements[0].phaseIds).toEqual([copy.phases[0].id]);
    expect(copy.phases[0].visibleElementIds).toEqual([copy.elements[0].id]);
    expect(() => validateProject(copy)).not.toThrow();
});

// Exercise the production persistence code in real browser IndexedDB, without a shipped test route.
async function loadDatabaseCode(page: Page) {
    const modules = Object.fromEntries(['model', 'database'].map((name) => [name, ts.transpileModule(readFileSync(`src/core/projects/${name}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText]));
    await page.evaluate((sources) => {
        const modules: Record<string, any> = {};
        for (const [name, code] of Object.entries(sources)) {
            const exports = {};
            new Function('exports', 'require', code)(exports, (key: string) => modules[key.replace('./', '')]);
            modules[name] = exports;
        }
        (window as any).projectTest = { ...modules.model, ...modules.database };
    }, modules);
}

test('IndexedDB commits metadata atomically, detects stale saves and rolls back aborted writes', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await loadDatabaseCode(page);
    const result = await page.evaluate(async () => {
        const { ProjectDatabase, createProject } = (window as any).projectTest;
        const db = await ProjectDatabase.open('atomic-test');
        const project = createProject('Original', 'benglen');
        const saved = await db.save(project, 0);
        let conflict = '';
        try {
            await db.save({ ...project, name: 'Stale tab' }, 0);
        } catch (error: any) {
            conflict = error.code;
        }
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value: unknown) {
            const request = put.call(this, value);
            this.transaction.abort();
            return request;
        };
        let failed = false;
        try {
            await db.save({ ...project, name: 'Must roll back' }, saved.revision);
        } catch {
            failed = true;
        } finally {
            IDBObjectStore.prototype.put = put;
        }
        const restored = await db.load(project.id);
        await db.remove(project.id, saved.revision);
        let deletedConflict = '';
        try {
            await db.save(project, saved.revision);
        } catch (error: any) {
            deletedConflict = error.code;
        }
        db.close();
        return { saved, restored, failed, conflict, deletedConflict };
    });
    expect(result.conflict).toBe('conflict');
    expect(result.deletedConflict).toBe('conflict');
    expect(result.failed).toBe(true);
    expect(result.restored).toEqual(result.saved);
    expect(result.saved.localChanges).toBe(true);
    expect(result.saved.revision).toBe(1);
});

test('migration preserves original, rejects invalid/future data and rolls back both stores', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await loadDatabaseCode(page);
    const result = await page.evaluate(async () => {
        const { ProjectDatabase, createProject } = (window as any).projectTest;
        const name = 'migration-test';
        const db = await ProjectDatabase.open(name);
        const project = createProject('Vorher', 'benglen');
        const original = await db.save(project, 0);
        // A fixture conversion exercises the upgrade transaction; no legacy format was shipped.
        let failures = 0;
        for (const transform of [
            () => ({ ...project, schemaVersion: 99 }),
            () => ({ ...project, id: crypto.randomUUID() }),
            () => {
                throw new Error('Migration failed');
            },
        ]) {
            try {
                await db.migrate(project.id, transform);
            } catch {
                failures += 1;
            }
        }
        const afterFailures = await db.raw(project.id);
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value: unknown) {
            const request = put.call(this, value);
            this.transaction.abort();
            return request;
        };
        try {
            await db.migrate(project.id, () => ({ ...project, name: 'Abort' }));
        } catch {
            failures += 1;
        } finally {
            IDBObjectStore.prototype.put = put;
        }
        const rawDb = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
        });
        const backups = () => new Promise<any[]>((resolve) => {
            const request = rawDb.transaction('backups').objectStore('backups').getAll();
            request.onsuccess = () => resolve(request.result);
        });
        const beforeSuccess = await backups();
        await db.migrate(project.id, (raw: any) => ({ ...raw.project, name: 'Nachher' }));
        const afterSuccess = await backups();
        const migrated = await db.load(project.id);
        // Unknown on-disk versions remain untouched on ordinary load.
        await new Promise<void>((resolve) => {
            const tx = rawDb.transaction('projects', 'readwrite');
            tx.objectStore('projects').put({ ...migrated, project: { ...project, schemaVersion: 99 } });
            tx.oncomplete = () => resolve();
        });
        let unsupported = '';
        try {
            await db.load(project.id);
        } catch (error: any) {
            unsupported = error.code;
        }
        const future = await db.raw(project.id);
        db.close();
        rawDb.close();
        return { original, afterFailures, failures, beforeSuccess, afterSuccess, migrated, unsupported, future };
    });
    expect(result.failures).toBe(4);
    expect(result.afterFailures).toEqual(result.original);
    expect(result.beforeSuccess).toEqual([]);
    expect(result.afterSuccess).toHaveLength(1);
    expect(result.afterSuccess[0].original).toEqual(result.original);
    expect(result.migrated.project.name).toBe('Nachher');
    expect(result.migrated.revision).toBe(2);
    expect(result.unsupported).toBe('version');
    expect(result.future.project.schemaVersion).toBe(99);
});

async function create(page: Page, name = 'Benglen Planung') {
    await openTab(page, 'Projekt');
    await page.getByLabel('Name des neuen Projekts').fill(name);
    await openTab(page, 'Projekt');
    await page.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
}

test('local project lifecycle, map selection and undo/redo survive offline reopen', async ({ page, context }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await openTab(page, 'Karten');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await openTab(page, 'Karten');
    await page.getByLabel('Vorbereitetes Gebiet').selectOption('benglen');
    await create(page);
    await openTab(page, 'Projekt');
    await page.getByLabel('Projektname', { exact: true }).fill('Übung Zürich');
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
    await openTab(page, 'Projekt');
    await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
    await expect(page.getByLabel('Projektname', { exact: true })).toHaveValue('Benglen Planung');
    await openTab(page, 'Projekt');
    await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
    await expect(page.getByLabel('Projektname', { exact: true })).toHaveValue('Übung Zürich');
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
    await context.setOffline(true);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/');
    await openTab(reopened, 'Projekt');
    await expect(reopened.getByLabel('Projektname', { exact: true })).toHaveValue('Übung Zürich');
    await expect(reopened.getByLabel('Vorbereitetes Gebiet')).toHaveValue('benglen');
    await expect(reopened.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await openTab(reopened, 'Projekt');
    await reopened.getByRole('button', { name: 'Duplizieren', exact: true }).click();
    await expect(reopened.getByLabel('Projektname', { exact: true })).toHaveValue('Übung Zürich · Kopie');
    await openTab(reopened, 'Projekt');
    await reopened.getByRole('button', { name: 'Löschen', exact: true }).click();
    await reopened.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(reopened.getByLabel('Projektname', { exact: true })).toHaveValue('Übung Zürich · Kopie');
    await openTab(reopened, 'Projekt');
    await reopened.getByRole('button', { name: 'Löschen', exact: true }).click();
    await openTab(reopened, 'Projekt');
    await reopened.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
    await expect(reopened.getByLabel('Projektname', { exact: true })).toHaveCount(0);
    await expect(reopened.getByLabel('Projekt öffnen').locator('option')).toHaveCount(2);
    await openTab(reopened, 'Projekt');
    await reopened.getByLabel('Projekt öffnen').selectOption({ label: 'Übung Zürich' });
    await expect(reopened.getByLabel('Projektname', { exact: true })).toHaveValue('Übung Zürich');
    await expect(reopened.locator('.map[aria-busy=\"false\"]')).toBeVisible();
    await expect(reopened.locator('.map')).toHaveAttribute('aria-busy', 'false');
    await reopened.screenshot({ path: 'test-results/projects-mobile.png', fullPage: true });
});

test('storage failure keeps draft, blocks navigation, retries, and does not claim saved', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await create(page);
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        (window as any).restoreStorage = () => {
            IDBObjectStore.prototype.put = put;
        };
        IDBObjectStore.prototype.put = function (value: unknown) {
            if (this.name === 'projects') {
                throw new DOMException('Full', 'QuotaExceededError');
            }
            return put.call(this, value);
        };
    });
    await openTab(page, 'Projekt');
    await page.getByLabel('Projektname', { exact: true }).fill('Ungesicherter Entwurf');
    await expect(page.getByText('Nicht gespeichert', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Projekt öffnen')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Projekt erstellen', exact: true })).toBeDisabled();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Entwurf als JSON sichern', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('as-tac-local-recovery.json');
    await page.evaluate(() => (window as any).restoreStorage());
    await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
    await page.reload();
    await openTab(page, 'Projekt');
    await expect(page.getByLabel('Projektname', { exact: true })).toHaveValue('Ungesicherter Entwurf');
});

test('two tabs cannot clobber each other; conflict draft can be recovered as independent project', async ({ page, context }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await create(page);
    const second = await context.newPage();
    await second.goto('/');
    await openTab(second, 'Projekt');
    await expect(second.getByLabel('Projektname', { exact: true })).toHaveValue('Benglen Planung');
    await openTab(page, 'Projekt');
    await page.getByLabel('Projektname', { exact: true }).fill('Erster Tab');
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
    await openTab(second, 'Projekt');
    await second.getByLabel('Projektname', { exact: true }).fill('Zweiter Tab');
    await expect(second.getByRole('alert')).toContainText('anderen Tab');
    await expect(second.getByLabel('Projektname', { exact: true })).toHaveValue('Zweiter Tab');
    await second.getByRole('button', { name: 'Entwurf als neues Projekt retten', exact: true }).click();
    await expect(second.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
    await expect(second.getByLabel('Projekt öffnen').locator('option')).toHaveCount(3);
    await openTab(second, 'Projekt');
    await second.getByLabel('Projekt öffnen').selectOption({ label: 'Erster Tab' });
    await expect(second.getByLabel('Projektname', { exact: true })).toHaveValue('Erster Tab');
});


test('editing during an in-flight commit never marks the newer draft saved prematurely', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await create(page);
    await page.evaluate(() => {
        const transaction = IDBDatabase.prototype.transaction;
        let delayOnce = true;
        IDBDatabase.prototype.transaction = function (...args: Parameters<typeof transaction>) {
            const tx = transaction.apply(this, args);
            if (delayOnce && args[1] === 'readwrite' && tx.objectStoreNames.contains('projects')) {
                delayOnce = false;
                const until = performance.now() + 1_000;
                const store = tx.objectStore('projects');
                const keepAlive = () => {
                    const request = store.count();
                    request.onsuccess = () => {
                        if (performance.now() < until) {
                            keepAlive();
                        }
                    };
                };
                keepAlive();
            }
            return tx;
        };
    });
    await openTab(page, 'Projekt');
    await page.getByLabel('Projektname', { exact: true }).fill('Erster Stand');
    await expect(page.getByText('Wird lokal gespeichert …', { exact: true })).toBeVisible();
    await openTab(page, 'Projekt');
    await page.getByLabel('Projektname', { exact: true }).fill('Neuer Stand');
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Auf diesem Gerät gespeichert', { exact: true })).toHaveText('Auf diesem Gerät gespeichert');
    await page.reload();
    await openTab(page, 'Projekt');
    await expect(page.getByLabel('Projektname', { exact: true })).toHaveValue('Neuer Stand');
});

test('database v1 upgrades to package storage without changing the saved project', async ({ page }) => {
    await page.goto('/');
    await openTab(page, 'Projekt');
    await loadDatabaseCode(page);
    const original = { project: fixture(), revision: 7, updatedAt: '2026-10-01T00:00:00.000Z', localChanges: true };
    const result = await page.evaluate(async (record) => {
        const name = 'upgrade-v1';
        await new Promise<void>((resolve) => {
            const opening = indexedDB.open(name, 1);
            opening.onupgradeneeded = () => {
                opening.result.createObjectStore('projects', { keyPath: 'project.id' }).put(record);
                opening.result.createObjectStore('backups', { keyPath: 'id' });
            };
            opening.onsuccess = () => {
                opening.result.close();
                resolve();
            };
        });
        const db = await (window as any).projectTest.ProjectDatabase.open(name);
        const saved = await db.load(record.project.id);
        const maps = await db.listMaps();
        db.close();
        return { saved, maps };
    }, original);
    expect(result.saved).toEqual(original);
    expect(result.maps).toEqual([]);
});

test('explicit schema changes preserve the previous record atomically with the save', async ({ page }) => {
    await page.goto('/');
    await loadDatabaseCode(page);
    const result = await page.evaluate(async () => {
        const { ProjectDatabase, createProject } = (window as any).projectTest;
        const db = await ProjectDatabase.open('format-backup');
        const original = await db.save(createProject('Vor Ebenen', 'benglen'), 0);
        const upgraded = { ...original.project, schemaVersion: 2, workspace: { layers: [], siteId: 'test', eventId: '', edition: '', source: '' } };
        await db.save(upgraded, 1);
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'projects') {
                throw new DOMException('Injected failure', 'QuotaExceededError');
            }
            return put.apply(this, args);
        };
        try {
            await db.save(original.project, 2);
        } catch {
            // Both the replacement and its backup must roll back.
        } finally {
            IDBObjectStore.prototype.put = put;
        }
        const current = await db.load(original.project.id);
        db.close();
        const stored = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open('format-backup');
            request.onsuccess = () => resolve(request.result);
        });
        const backups = await new Promise<any[]>((resolve) => {
            const request = stored.transaction('backups').objectStore('backups').getAll();
            request.onsuccess = () => resolve(request.result);
        });
        stored.close();
        return { original, current, backups };
    });
    expect(result.current.project.schemaVersion).toBe(2);
    expect(result.current.revision).toBe(2);
    expect(result.backups).toHaveLength(1);
    expect(result.backups[0].original).toEqual(result.original);
});
