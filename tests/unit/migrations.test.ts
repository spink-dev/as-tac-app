import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Dexie from 'dexie';
import { FORMAT_VERSION, ProjectSchema, type Project } from '../../src/core/model/schema';
import { migrateEntity, migrateProject, migrateProjectRecord, migrateRecord, missingSteps, PROJECT_STEPS, type ProjectStep } from '../../src/core/model/migrations';
import { readImportFile } from '../../src/core/files/astac';
import { decodePlanLink, LINK_PREFIX } from '../../src/core/files/link';
import { presetTeams } from '../../src/core/files/presets';
import { verifyArea } from '../../src/core/areas/store';
import { AREA_FORMAT_VERSION, AREA_STEPS } from '../../src/core/areas/types';
import { migratePrefs, normalizePrefs, PREFS_VERSION } from '../../src/core/store/prefs';
import { AsTacDatabase, db } from '../../src/core/storage/db';
import { deleteProject, loadProject, loadStored, restoreDeleted, saveProject, STORED_FORMAT, type StoredFormat } from '../../src/core/storage/projects';
import { metaOf } from '../../src/core/store/diff';

const DIR = new URL('../fixtures/formats/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DIR));
const json = (name: string) => JSON.parse(read(name).toString('utf8')) as Record<string, unknown>;
const nowhere = async () => {
    throw new Error('placement should not be asked');
};

describe('frozen format samples', () => {
    it('are unchanged (fix the migration, never the sample)', () => {
        const lines = read('SHA256SUMS').toString('utf8').trim().split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(6);
        for (const line of lines) {
            const [hash, name] = line.split(/\s+/);
            expect(createHash('sha256').update(read(name)).digest('hex'), name).toBe(hash);
        }
    });

    it('opens the plan format of 1.0.0-alpha.1/2 (format 1) with every collection intact', () => {
        const sample = json('project-v1.json');
        const project = migrateProject(sample);
        expect(project.formatVersion).toBe(FORMAT_VERSION);
        for (const collection of ['layers', 'teams', 'images', 'phases', 'elements', 'drawings', 'log', 'tracks'] as const) {
            expect(project[collection].length, collection).toBe((sample[collection] as unknown[]).length);
        }
        expect(project.elements.map((e) => e.kind)).toEqual(expect.arrayContaining(['marker', 'route', 'zone', 'text', 'bearing']));
        expect(project.drawings.some((d) => d.briefingOnly)).toBe(true);
    });

    it('opens an .astac archive (container format 2) with its pictures', async () => {
        const result = await readImportFile(new Blob([new Uint8Array(read('archive-v2.astac'))]), nowhere);
        expect(result.kind).toBe('project');
        if (result.kind === 'project') {
            expect(result.project.name).toBe('Formatprobe 1.0.0-alpha.2');
            expect(result.project.tracks).toHaveLength(1);
            expect(result.project.images).toHaveLength(2);
            expect(result.project.elements.some((e) => e.attachments?.length)).toBe(true);
            expect(result.area?.id).toBe('probe-area');
            expect(result.missingAssets).toBe(0);
        }
    });

    it('opens a plan link', async () => {
        const link = read('link-v1.txt').toString('utf8').trim();
        const project = await decodePlanLink(link.slice(link.indexOf(LINK_PREFIX)));
        expect(project.name).toBe('Linkprobe');
        expect(project.elements).toHaveLength(2);
    });

    it('opens a team preset written before presets carried the plan format', () => {
        const result = presetTeams(json('teams-v1.json'));
        expect(result).not.toBe('invalid');
        expect(result).not.toBe('newer');
        if (typeof result === 'object') {
            expect(result.teams.map((team) => team.name)).toEqual(['Alpha', 'Bravo', 'Rot']);
        }
    });

    it('opens an area package (format 1)', async () => {
        const area = await verifyArea(json('area-v1.astac-map.json'));
        expect(area.featureCount).toBe(2);
    });

    it('brings 1.0.0-alpha.1 preferences up to date', () => {
        const { prefs, version } = migratePrefs(json('prefs-alpha1.json'), 'en-US');
        expect(version).toBe(PREFS_VERSION);
        const normal = normalizePrefs(prefs, 'day').prefs;
        expect(normal).toMatchObject({ locale: 'de', bearingUnit: 'mil', keybinds: { 'tool.marker': 'q' }, displayName: 'Sam', mediaDownload: 'wifi' });
    });
});

describe('newer formats are refused, never guessed', () => {
    it('plans, archives, links, presets and areas from a newer app', async () => {
        const sample = json('project-v1.json');
        expect(() => migrateProject({ ...sample, formatVersion: FORMAT_VERSION + 1 })).toThrow('project-newer');
        expect(presetTeams({ ...json('teams-v1.json'), projectFormatVersion: FORMAT_VERSION + 1 })).toBe('newer');
        expect(presetTeams({ ...json('teams-v1.json'), formatVersion: 2 })).toBe('newer');
        // The version decides before the shape: a newer file may look different.
        expect(presetTeams({ format: 'as-tac-teams', formatVersion: 2, members: [] })).toBe('newer');
        expect(presetTeams({ format: 'as-tac-teams', formatVersion: 1, projectFormatVersion: FORMAT_VERSION + 1, teams: new Array(500).fill({}) })).toBe('newer');
        await expect(verifyArea({ ...json('area-v1.astac-map.json'), formatVersion: AREA_FORMAT_VERSION + 1 })).rejects.toThrow('area-newer');
    });

    it('plans with no or a broken version', () => {
        const sample = json('project-v1.json');
        expect(() => migrateProject({ ...sample, formatVersion: undefined })).toThrow('project-invalid');
        expect(() => migrateProject({ ...sample, formatVersion: 0 })).toThrow('project-invalid');
        expect(() => migrateProject({ ...sample, formatVersion: '1' })).toThrow('project-invalid');
        expect(() => migrateProject([])).toThrow('project-invalid');
    });
});

describe('migration steps', () => {
    it('cover every released format without gaps', () => {
        expect(missingSteps(FORMAT_VERSION, PROJECT_STEPS)).toEqual([]);
        expect(missingSteps(AREA_FORMAT_VERSION, AREA_STEPS)).toEqual([]);
    });

    // A made-up format 2: marker labels move into `title`, a new setting appears, a new plan field.
    const future: Record<number, ProjectStep> = {
        1: {
            entity: {
                elements: (e) => (e.kind === 'marker' ? { ...e, title: e.label ?? null } : e),
                meta: (m) => ({ ...m, settings: { ...(m.settings as object), compass: 'auto' } }),
            },
            project: (p) => ({ ...p, revision: 1 }),
        },
    };

    it('apply entity steps to every entity, the meta record and the plan', () => {
        const sample = json('project-v1.json');
        const migrated = migrateProjectRecord(sample, 2, future);
        expect(migrated.formatVersion).toBe(2);
        expect(migrated.revision).toBe(1);
        expect((migrated.settings as Record<string, unknown>).compass).toBe('auto');
        const markers = (migrated.elements as Record<string, unknown>[]).filter((e) => e.kind === 'marker');
        expect(markers.length).toBeGreaterThan(0);
        expect(markers.every((m) => 'title' in m && m.title === (m.label ?? null))).toBe(true);
        expect(migrated.name).toBe(sample.name);
        // The input is not touched.
        expect(sample.formatVersion).toBe(1);
        expect('revision' in sample).toBe(false);
    });

    it('migrate a single live entity exactly like the same entity inside a plan', () => {
        const sample = json('project-v1.json');
        const marker = (sample.elements as Record<string, unknown>[]).find((e) => e.kind === 'marker') as Record<string, unknown>;
        const inPlan = (migrateProjectRecord(sample, 2, future).elements as Record<string, unknown>[]).find((e) => e.id === marker.id);
        expect(migrateEntity('elements', marker, 1, 2, future)).toEqual(inPlan);
        expect(migrateEntity('layers', { id: 'x' }, 1, 2, future)).toEqual({ id: 'x' });
        expect(() => migrateEntity('elements', marker, 3, 2, future)).toThrow('entity-newer');
    });

    it('give meta steps the same record in a plan as in a live session', () => {
        const sample = json('project-v1.json');
        const plain = { ...sample };
        delete plain.event;
        const seen: unknown[] = [];
        const steps: Record<number, ProjectStep> = { 1: { entity: { meta: (m) => {
            seen.push(m);
            return { ...m, event: m.event ?? null };
        } } } };
        const migrated = migrateProjectRecord(plain, 2, steps);
        // A plan without event keeps the field absent (null would fail validation).
        expect('event' in migrated).toBe(false);
        const live = metaOf(ProjectSchema.parse(plain) as Project) as unknown as Record<string, unknown>;
        expect(seen[0]).toEqual(live);
        expect(migrateEntity('meta', live, 1, 2, steps)).toEqual({ ...live, event: null });
    });

    it('leave live entities alone in plan-only steps (those must not touch entities)', () => {
        const steps: Record<number, ProjectStep> = { 1: { project: (p) => ({ ...p, view: undefined }) } };
        expect(migrateEntity('teams', { id: 't' }, 1, 2, steps)).toEqual({ id: 't' });
    });

    it('state the new version on the record after each step', () => {
        const migrated = migrateRecord({ formatVersion: 1, a: 1 } as Record<string, unknown>, 1, 3, { 1: (r) => ({ ...r, b: 1 }), 2: (r) => r }, 'area', 'formatVersion');
        expect(migrated).toEqual({ formatVersion: 3, a: 1, b: 1 });
    });

    it('refuse a missing step instead of skipping it', () => {
        expect(() => migrateProjectRecord(json('project-v1.json'), 3, future)).toThrow('project-invalid');
        expect(() => migrateRecord({ formatVersion: 1 }, 1, 2, {}, 'area')).toThrow('area-invalid');
    });
});

describe('plans saved on this device', () => {
    const sample = () => ProjectSchema.parse(json('project-v1.json')) as Project;
    // This app pretends to be format 2; a stored format-1 plan must be migrated.
    const future = (onMigrate: () => void): StoredFormat => ({
        current: 2,
        migrate: (input) => {
            onMigrate();
            return { ...(ProjectSchema.parse(input) as Project), name: 'Migriert', formatVersion: 2 as 1 };
        },
        parse: (input) => input as Project,
    });

    it('are read with the real migration', () => {
        expect(STORED_FORMAT.migrate).toBe(migrateProject);
        expect(STORED_FORMAT.current).toBe(FORMAT_VERSION);
    });

    it('open as they are in the current format', async () => {
        const project = sample();
        await saveProject(project);
        const loaded = await loadProject(project.id);
        expect(loaded.elements).toHaveLength(project.elements.length);
        expect(await db.backups.where('projectId').equals(project.id).count()).toBe(0);
    });

    it('from an older format are migrated, backed up and written back once', async () => {
        const project = { ...sample(), id: 'prj_old_format' };
        await saveProject(project);
        let runs = 0;
        const format = future(() => {
            runs += 1;
        });
        const loaded = await loadStored(project.id, format);
        expect(loaded.name).toBe('Migriert');
        const backup = await db.backups.get(`${project.id}@1`);
        expect((backup?.data as Project).name).toBe(project.name);
        expect((await db.projects.get(project.id))?.data.name).toBe('Migriert');
        expect((await db.projectIndex.get(project.id))?.name).toBe('Migriert');
        expect((await db.projectIndex.get(project.id))?.updatedAt).toBe(project.updatedAt);
        await loadStored(project.id, format);
        expect(runs).toBe(1);
    });

    it('never overwrite an existing backup', async () => {
        const project = { ...sample(), id: 'prj_backup_kept' };
        await saveProject(project);
        await db.backups.put({ id: `${project.id}@1`, projectId: project.id, formatVersion: 1, appVersion: 'old', createdAt: new Date().toISOString(), data: { original: true } });
        await loadStored(project.id, future(() => undefined));
        expect((await db.backups.get(`${project.id}@1`))?.data).toEqual({ original: true });
    });

    it('still open when the migrated plan cannot be written back', async () => {
        const project = { ...sample(), id: 'prj_storage_full' };
        await saveProject(project);
        const refuse = () => {
            throw new Error('QuotaExceededError');
        };
        db.projects.hook('updating', refuse);
        try {
            const loaded = await loadStored(project.id, future(() => undefined));
            expect(loaded.name).toBe('Migriert');
        } finally {
            db.projects.hook('updating').unsubscribe(refuse);
        }
        expect((await db.projects.get(project.id))?.data.name).toBe(project.name);
        expect(await db.backups.get(`${project.id}@1`)).toBeUndefined();
    });

    it('from a newer app are refused, never overwritten, and can be deleted with undo', async () => {
        const project = { ...sample(), id: 'prj_newer_format' };
        await saveProject(project);
        const newer = { ...project, formatVersion: FORMAT_VERSION + 1, futureField: true };
        await db.projects.put({ id: project.id, data: newer as unknown as Project });
        await expect(loadProject(project.id)).rejects.toThrow('newer');
        await expect(saveProject({ ...project, name: 'Stale' })).rejects.toThrow('newer');
        expect((await db.projects.get(project.id))?.data).toEqual(newer);
        expect(await db.backups.where('projectId').equals(project.id).count()).toBe(0);

        const removed = await deleteProject(project.id);
        expect(await db.projects.get(project.id)).toBeUndefined();
        await restoreDeleted(removed);
        expect((await db.projects.get(project.id))?.data).toEqual(newer);
        expect((await db.projectIndex.get(project.id))?.name).toBe(project.name);
    });

    it('that are damaged are refused', async () => {
        await db.projects.put({ id: 'prj_damaged', data: { formatVersion: 1, name: 42 } as unknown as Project });
        await expect(loadProject('prj_damaged')).rejects.toThrow('invalid');
    });
});

describe('device database', () => {
    const NAME = 'as-tac-upgrade-test';
    const alpha1 = (database: Dexie) => {
        // The schema exactly as 1.0.0-alpha.1 declared it (versions 1–3).
        database.version(1).stores({ projects: 'id', projectIndex: 'id, updatedAt', assets: 'hash', areas: 'id', liveLinks: 'projectId, remoteId', outbox: '++seq, projectId', kv: 'key' });
        database.version(2).stores({ areaMeta: 'id' });
        database.version(3).stores({ outbox: null, liveOutbox: 'id, projectId' });
    };

    it('upgrades a 1.0.0-alpha.1 database without losing plans or queued live changes', async () => {
        const old = new Dexie(NAME);
        alpha1(old);
        await old.open();
        const project = json('project-v1.json');
        await old.table('projects').put({ id: project.id, data: project });
        await old.table('projectIndex').put({ id: project.id, name: project.name, updatedAt: project.updatedAt, areaId: project.areaId, elementCount: 31 });
        await old.table('liveOutbox').put({ id: `${project.id}|elements:el_m1`, projectId: project.id, collection: 'elements', entityId: 'el_m1', data: { id: 'el_m1' }, prev: null, base: 0, order: 1, clientId: 'c1', createdAt: '2026-11-08T10:00:00.000Z' });
        old.close();

        const current = new AsTacDatabase(NAME);
        await current.open();
        expect(current.verno).toBe(4);
        expect((await current.projects.get(project.id as string))?.data.name).toBe(project.name);
        expect(await current.liveOutbox.count()).toBe(1);
        expect(await current.backups.count()).toBe(0);
        current.close();
    });

    it('still opens after a newer app added a table (going back a version)', async () => {
        const newer = new Dexie(NAME);
        alpha1(newer);
        newer.version(4).stores({ backups: 'id, projectId, createdAt' });
        newer.version(5).stores({ futureTable: 'id' });
        await newer.open();
        newer.close();

        const current = new AsTacDatabase(NAME);
        await current.open();
        expect(await current.projects.count()).toBe(1);
        expect(await current.liveOutbox.count()).toBe(1);
        current.close();
    });
});
