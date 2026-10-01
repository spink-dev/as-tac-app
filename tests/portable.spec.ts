import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync } from 'fflate';
import { digest, encode, pack, unpack } from '../src/core/portable/archive';
import { createProject, type Phase } from '../src/core/projects/model';
import { makeElement } from '../src/features/editor/geometry';

async function fixture() {
    const project = createProject('Verteilter Einsatz', 'benglen');
    const team = { id: crypto.randomUUID(), name: 'Alpha', shortLabel: 'A', colour: '#176b89' };
    const element = makeElement(project.id, 'point', [[8.63, 47.36]], 'Treffpunkt');
    const phase: Phase = { id: crypto.randomUUID(), title: 'Start', notes: 'Am Tor sammeln', order: 0, camera: { center: [8.63, 47.36], zoom: 15, bearing: 0, pitch: 0 }, visibleElementIds: [element.id] };
    element.teamId = team.id;
    element.phaseIds = [phase.id];
    project.teams = [team];
    project.elements = [element];
    project.phases = [phase];
    const map = { ...JSON.parse(readFileSync('public/maps/benglen.json', 'utf8')), format: 'as-tac-map', formatVersion: 1, data: JSON.parse(readFileSync('public/maps/benglen.geojson', 'utf8')) };
    const files: Record<string, Uint8Array> = {
        'project.json': encode(project), 'maps/area.json': encode(map),
        'credits/ODbL-1.0.txt': readFileSync('public/licenses/ODbL-1.0.txt'),
        'credits/CREDITS.md': readFileSync('CREDITS.md'),
        'credits/renderer.json': encode({ id: 'as-tac-vector', version: 1, fonts: 'system', externalResources: [] }),
    };
    files['manifest.json'] = encode({ format: 'as-tac', formatVersion: 1, appVersion: '0.3.0-alpha.1', createdAt: new Date().toISOString(), projectId: project.id, planRevision: 1,
        resources: await Promise.all(Object.entries(files).map(async ([path, data]) => ({ path, bytes: data.length, sha256: await digest(data) }))) });
    return { files, project, bytes: pack(files) };
}

test('bounded ZIP rejects traversal, duplicates, truncation and dishonest expanded lengths', async () => {
    const { bytes, files } = await fixture();
    const signal = new AbortController().signal;
    expect(Object.keys(await unpack(bytes, signal))).toHaveLength(6);
    await expect(unpack(bytes.subarray(0, bytes.length - 1), signal)).rejects.toThrow();
    const bad = { ...files, '../project.json': files['project.json'] };
    delete (bad as any)['project.json'];
    await expect(unpack(zipSync(bad), signal)).rejects.toThrow();
    const duplicateFiles = { ...files, 'project.jsoN': files['project.json'] };
    delete (duplicateFiles as any)['credits/renderer.json'];
    const duplicate = zipSync(duplicateFiles);
    // Rename the second entry in both headers to create a duplicate path.
    const text = new TextEncoder().encode('project.jsoN');
    const replacement = new TextEncoder().encode('project.json');
    for (let i = 0; i < duplicate.length - text.length; i++) {
        if (text.every((v, n) => duplicate[i + n] === v)) {
            duplicate.set(replacement, i);
        }
    }
    await expect(unpack(duplicate, signal)).rejects.toThrow();
    const lying = new Uint8Array(bytes);
    const view = new DataView(lying.buffer);
    const dir = view.getUint32(lying.length - 6, true);
    view.setUint32(22, 1, true);
    view.setUint32(dir + 24, 1, true);
    await expect(unpack(lying, signal)).rejects.toThrow('size');
    const abort = new AbortController();
    abort.abort();
    await expect(unpack(bytes, abort.signal)).rejects.toThrow();
});

test('complete package roundtrip across isolated devices, offline readonly reopen, editable copy', async ({ page, browser }) => {
    const { bytes } = await fixture();
    await page.goto('/');
    await expect(page.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await page.getByLabel('Projektpaket öffnen (.astac.zip)').setInputFiles({ name: 'einsatz.astac.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
    await expect(page.getByText('Projekt und Karte gemeinsam gespeichert · schreibgeschützte Kopie geöffnet.')).toBeVisible();
    await expect(page.getByLabel('Projektname', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Plan bearbeiten', exact: true })).toBeDisabled();
    await expect(page.locator('.map-caption')).toContainText('Benglen');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Vollständiges Projekt sichern (.astac.zip)' }).click();
    const bytes2 = readFileSync((await (await downloaded).path())!);
    const files = unzipSync(bytes2);
    const exported = JSON.parse(new TextDecoder().decode(files['project.json']));
    expect(exported.teams[0].name).toBe('Alpha');
    expect(exported.phases[0].visibleElementIds).toEqual([exported.elements[0].id]);
    expect(exported.elements[0].teamId).toBe(exported.teams[0].id);
    const second = await browser.newContext();
    const other = await second.newPage();
    await other.goto('/');
    await expect(other.getByText('Offline bereit · Dateien geprüft')).toBeVisible();
    await second.setOffline(true);
    await other.getByLabel('Projektpaket öffnen (.astac.zip)').setInputFiles({ name: 'copy.astac.zip', mimeType: 'application/zip', buffer: bytes2 });
    await expect(other.getByLabel('Projektname', { exact: true })).toHaveValue('Verteilter Einsatz');
    await other.reload();
    await expect(other.getByLabel('Projektname', { exact: true })).toBeDisabled();
    await expect(other.locator('.map-caption')).toContainText('Benglen');
    await other.getByRole('button', { name: 'Briefing starten', exact: true }).click();
    await expect(other.getByRole('button', { name: 'In Plan übernehmen', exact: true })).toBeDisabled();
    await other.getByRole('button', { name: 'Briefing beenden', exact: true }).click();
    await other.getByRole('button', { name: 'Bearbeitbare Kopie erstellen', exact: true }).click();
    await expect(other.getByLabel('Projektname', { exact: true })).toBeEnabled();
    await expect(other.getByLabel('Projekt öffnen').locator('option')).toHaveCount(3);
    await second.close();
});

test('hash corruption and transaction failure install neither project nor map', async ({ page }) => {
    const { files, bytes } = await fixture();
    files['project.json'] = encode({ ...JSON.parse(new TextDecoder().decode(files['project.json'])), name: 'Tampered' });
    await page.goto('/');
    const input = page.getByLabel('Projektpaket öffnen (.astac.zip)');
    await input.setInputFiles({ name: 'bad.astac.zip', mimeType: 'application/zip', buffer: Buffer.from(pack(files)) });
    await expect(page.getByText(/Projektpaket konnte nicht verarbeitet werden/)).toBeVisible();
    await expect(page.getByLabel('Projekt öffnen').locator('option')).toHaveCount(1);
    await page.evaluate(() => {
        const add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) {
            if (this.name === 'projects') {
                throw new DOMException('Injected enqueue failure', 'DataCloneError');
            }
            return add.apply(this, args);
        };
    });
    await input.setInputFiles({ name: 'valid.astac.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
    await expect(page.getByText(/Projektpaket konnte nicht verarbeitet werden/)).toBeVisible();
    expect(await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open('as-tac-projects');
            request.onsuccess = () => resolve(request.result);
        });
        const result = await Promise.all(['projects', 'maps'].map((name) => new Promise<number>((resolve) => {
            const request = db.transaction(name).objectStore(name).count();
            request.onsuccess = () => resolve(request.result);
        })));
        db.close();
        return result;
    })).toEqual([0, 0]);
});
