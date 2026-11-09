import { FORMAT_VERSION } from '../model/schema';
import { isJson, migrateEntity, PROJECT_STEPS, type EntityKind, type ProjectStep } from '../model/migrations';
import type { RemoteCollection } from './types';

/**
 * Live data travels between devices that may run different app versions. Every entity a device
 * sends carries the plan format it was written in (`_fv`; absent = format 1, as written before
 * 1.0.0-alpha.2). A receiver brings older entities forward with the same per-entity steps as
 * stored plans (model/migrations.ts) and never applies an entity from a newer format: it keeps
 * its changes queued and asks for an update instead of guessing. Order lists and deletions carry
 * no format.
 */
export const FORMAT_KEY = '_fv';

/** Plan formats a newer app can plausibly be ahead by (one per release at most). */
const MAX_AHEAD = 20;

function kindOf(collection: RemoteCollection): EntityKind | null {
    return collection === 'order' ? null : collection;
}

/** Outgoing: the entity data tagged with the format it is in. */
export function tagFormat(collection: RemoteCollection, data: unknown, version: number = FORMAT_VERSION): unknown {
    return kindOf(collection) && isJson(data) ? { ...data, [FORMAT_KEY]: version } : data;
}

export type Incoming =
    | { ok: true; data: unknown }
    /**
     * `newer`: written by a newer app (format in `newer`) — held, fetched again after the update.
     * `tag`: a broken or implausible tag — no update will make it readable.
     * `migration`: a migration step failed on it — a later release may fix the step, so it is held too.
     */
    | { ok: false; reason: 'newer' | 'tag' | 'migration'; newer: number | null };

/** Incoming: the tag removed and older data migrated to `current`. */
export function readFormat(collection: RemoteCollection, data: unknown, current: number = FORMAT_VERSION, steps: Readonly<Record<number, ProjectStep>> = PROJECT_STEPS): Incoming {
    const kind = kindOf(collection);
    if (!kind || !isJson(data)) {
        return { ok: true, data };
    }
    const { [FORMAT_KEY]: tag, ...rest } = data;
    const version = tag === undefined ? 1 : tag;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        return { ok: false, reason: 'tag', newer: null };
    }
    if (version > current + MAX_AHEAD) {
        // No real app is that far ahead: a broken or hostile tag must not lock every partner out.
        return { ok: false, reason: 'tag', newer: null };
    }
    if (version > current) {
        return { ok: false, reason: 'newer', newer: version };
    }
    if (version === current) {
        return { ok: true, data: rest };
    }
    try {
        return { ok: true, data: migrateEntity(kind, rest, version, current, steps) };
    } catch (error) {
        console.warn('live: migration step failed', collection, error);
        return { ok: false, reason: 'migration', newer: null };
    }
}

/**
 * A queued change written by another app version of this device (the queue survives updates):
 * older ones are migrated like incoming data; `newer` when it comes from a newer app (rollback).
 */
export function migrateQueued<T extends { collection: string; data: unknown; prev: unknown; unacked?: unknown[]; formatVersion?: number }>(
    row: T, current: number = FORMAT_VERSION, steps: Readonly<Record<number, ProjectStep>> = PROJECT_STEPS,
): { row: T; changed: boolean } | { newer: number } | null {
    const from = row.formatVersion ?? 1;
    if (from > current) {
        return { newer: from };
    }
    if (from === current) {
        // 1.0.0-alpha.1 kept received tags inside its entities and could queue them: drop them.
        const strip = (value: unknown) => (isJson(value) && FORMAT_KEY in value ? (({ [FORMAT_KEY]: _tag, ...rest }) => rest)(value) : value);
        const tagged = [row.data, row.prev, ...(row.unacked ?? [])].some((value) => isJson(value) && FORMAT_KEY in value);
        return tagged ? { row: { ...row, data: strip(row.data), prev: strip(row.prev), unacked: row.unacked?.map(strip) }, changed: true } : { row, changed: false };
    }
    const collection = row.collection as RemoteCollection;
    const one = (value: unknown) => {
        const result = readFormat(collection, tagFormat(collection, value, from), current, steps);
        if (!result.ok) {
            throw new Error('queued-invalid');
        }
        return result.data;
    };
    try {
        return {
            row: { ...row, data: one(row.data), prev: one(row.prev), unacked: row.unacked?.map(one), formatVersion: current },
            changed: true,
        };
    } catch {
        return null;
    }
}
