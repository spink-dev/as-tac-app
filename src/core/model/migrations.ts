import { FORMAT_VERSION, ProjectSchema, type Project, type SyncedCollection } from './schema';

/**
 * Format migrations. Every stored or transmitted record carries the format version it was written
 * in; readers bring older records forward one version at a time and refuse newer ones instead of
 * guessing (a newer record is never overwritten or "repaired").
 *
 * Changing the plan format:
 * 1. bump FORMAT_VERSION in schema.ts and change the schema;
 * 2. add `PROJECT_STEPS[old]` below — per entity where possible, because live sessions migrate
 *    single entities (`migrateEntity`) with the same steps;
 * 3. keep tests/fixtures/formats/project-v<old>.json as it is (it must still open) and add a
 *    sample of the new format; never edit an existing fixture to make a test pass.
 * 4. live: a build with a new format must not share a backend with production before its release
 *    (every older member would hold its changes until updated); 1.0.0-alpha.1 applies received
 *    `_fv` tags and sends them back, so data it edits can carry a newer tag than it was written in.
 */

export type Json = Record<string, unknown>;

/** What a step can address: one entity of a synced collection, a track, or `meta` (plan name, area, event, settings). */
export type EntityKind = SyncedCollection | 'tracks' | 'meta';

export interface ProjectStep {
    /** Turns one entity of version n into version n+1. */
    entity?: Partial<Record<EntityKind, (entity: Json) => Json>>;
    /**
     * Plan-wide change after the entity steps, only for fields that are not synced entity by entity
     * (e.g. `view`). It must not change the shape of entities or `meta`: live sessions migrate single
     * entities with the `entity` steps alone, so anything done here would never reach them.
     */
    project?: (project: Json) => Json;
}

/** `PROJECT_STEPS[n]` turns plan format n into n+1. Format 1 is the first 1.0 format: nothing to do yet. */
export const PROJECT_STEPS: Readonly<Record<number, ProjectStep>> = {};

/**
 * Plan-level fields that live sessions send as the `meta` entity. Steps see them in exactly the shape
 * of store/diff.ts `metaOf` (`event: null` when there is none), in a plan as in a live session.
 * When a format changes the meta fields, this list and `metaRecord` must describe the meta of the
 * version each step starts from (make them depend on the step's version then).
 */
const META_FIELDS = ['name', 'areaId', 'event', 'settings'] as const;

function metaRecord(project: Json): Json {
    return { name: project.name, areaId: project.areaId ?? null, event: project.event ?? null, settings: project.settings };
}
const COLLECTIONS: readonly EntityKind[] = ['layers', 'teams', 'images', 'phases', 'elements', 'drawings', 'log', 'tracks'];

export function isJson(value: unknown): value is Json {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The format version a record declares; `NaN` when it has none or a nonsensical one. */
export function versionOf(value: unknown, field = 'formatVersion'): number {
    const version = isJson(value) ? value[field] : NaN;
    return typeof version === 'number' && Number.isInteger(version) && version >= 1 ? version : NaN;
}

/**
 * Bring any versioned record from `from` to `to` with `steps[n]` (n → n+1). Throws `<prefix>-newer`
 * for records from a newer app and `<prefix>-invalid` for unknown versions or a missing step.
 */
export function migrateRecord<T>(value: T, from: number, to: number, steps: Readonly<Record<number, (value: T) => T>>, prefix: string, versionField?: string): T {
    if (!Number.isInteger(from) || from < 1) {
        throw new Error(`${prefix}-invalid`);
    }
    if (from > to) {
        throw new Error(`${prefix}-newer`);
    }
    let current = value;
    for (let version = from; version < to; version++) {
        const step = steps[version];
        if (!step) {
            throw new Error(`${prefix}-invalid`);
        }
        current = step(structuredClone(current));
        if (versionField && isJson(current)) {
            // The record states its new version itself; a step need not remember to.
            (current as Json)[versionField] = version + 1;
        }
    }
    return current;
}

/** One entity (as sent in live sessions or stored in the live queue) from format `from` to `to`. */
export function migrateEntity(kind: EntityKind, entity: Json, from: number, to: number = FORMAT_VERSION, steps: Readonly<Record<number, ProjectStep>> = PROJECT_STEPS): Json {
    const entitySteps = Object.fromEntries(Object.entries(steps).map(([version, step]) => [version, (value: Json) => step.entity?.[kind]?.(value) ?? value]));
    return migrateRecord(entity, from, to, entitySteps, 'entity');
}

/** A whole plan record (unvalidated) from its own format to `to`. */
export function migrateProjectRecord(input: unknown, to: number = FORMAT_VERSION, steps: Readonly<Record<number, ProjectStep>> = PROJECT_STEPS): Json {
    if (!isJson(input)) {
        throw new Error('project-invalid');
    }
    const projectSteps = Object.fromEntries(Object.entries(steps).map(([version, step]) => [version, (project: Json): Json => {
        let next = project;
        for (const [kind, fn] of Object.entries(step.entity ?? {}) as [EntityKind, (entity: Json) => Json][]) {
            if (kind === 'meta') {
                const meta = fn(metaRecord(next));
                for (const field of META_FIELDS) {
                    if (field === 'event' && (meta.event === null || meta.event === undefined)) {
                        // Plans store "no event" as an absent field.
                        delete next.event;
                    } else if (field in meta) {
                        next[field] = meta[field];
                    }
                }
            } else if (COLLECTIONS.includes(kind) && Array.isArray(next[kind])) {
                next[kind] = (next[kind] as unknown[]).map((entity) => (isJson(entity) ? fn(entity) : entity));
            }
        }
        if (step.project) {
            next = step.project(next);
        }
        next.formatVersion = Number(version) + 1;
        return next;
    }]));
    return migrateRecord(input, versionOf(input), to, projectSteps, 'project');
}

/** Migrate and validate an untrusted plan (file, link, stored record). */
export function migrateProject(input: unknown): Project {
    const migrated = migrateProjectRecord(input);
    const parsed = ProjectSchema.safeParse(migrated);
    if (!parsed.success) {
        console.warn('project failed validation', parsed.error.issues.slice(0, 5));
        throw new Error('project-invalid');
    }
    return parsed.data as Project;
}

/** Versions in 1..current-1 without a step (must be empty, see tests). */
export function missingSteps(current: number, steps: Readonly<Record<number, unknown>>): number[] {
    return Array.from({ length: Math.max(0, current - 1) }, (_, i) => i + 1).filter((version) => !steps[version]);
}
