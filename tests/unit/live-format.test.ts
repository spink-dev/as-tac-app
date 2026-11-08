import { describe, expect, it } from 'vitest';
import { FORMAT_KEY, migrateQueued, readFormat, tagFormat } from '../../src/core/live/format';
import { FORMAT_VERSION } from '../../src/core/model/schema';
import type { ProjectStep } from '../../src/core/model/migrations';

// A made-up format 2: markers get a `title`.
const future: Record<number, ProjectStep> = { 1: { entity: { elements: (e) => (e.kind === 'marker' ? { ...e, title: e.label ?? null } : e) } } };
const marker = { kind: 'marker', id: 'm1', pos: [8.5, 47.3], type: 'unit', label: 'Alpha' };

describe('live format tags', () => {
    it('tag outgoing entities, not order lists or deletions', () => {
        expect(tagFormat('elements', marker)).toEqual({ ...marker, [FORMAT_KEY]: FORMAT_VERSION });
        expect(tagFormat('meta', { name: 'x' })).toEqual({ name: 'x', [FORMAT_KEY]: FORMAT_VERSION });
        expect(tagFormat('order', ['a', 'b'])).toEqual(['a', 'b']);
        expect(tagFormat('elements', null)).toBeNull();
    });

    it('take the current format as it is, without the tag', () => {
        expect(readFormat('elements', tagFormat('elements', marker))).toEqual({ ok: true, data: marker });
        expect(readFormat('order', ['a'])).toEqual({ ok: true, data: ['a'] });
        expect(readFormat('elements', null)).toEqual({ ok: true, data: null });
    });

    it('treat untagged data (before 1.0.0-alpha.2) as format 1 and migrate older data', () => {
        expect(readFormat('elements', marker, 2, future)).toEqual({ ok: true, data: { ...marker, title: 'Alpha' } });
        expect(readFormat('elements', { ...marker, [FORMAT_KEY]: 1 }, 2, future)).toEqual({ ok: true, data: { ...marker, title: 'Alpha' } });
    });

    it('refuse data from a newer app and report its format', () => {
        expect(readFormat('elements', { ...marker, [FORMAT_KEY]: FORMAT_VERSION + 1 })).toEqual({ ok: false, reason: 'newer', newer: FORMAT_VERSION + 1 });
        expect(readFormat('elements', { ...marker, [FORMAT_KEY]: FORMAT_VERSION + 20 })).toMatchObject({ ok: false, reason: 'newer' });
    });

    it('call a tag no update can read broken (no lock-out by a far-future or garbage tag)', () => {
        expect(readFormat('elements', { ...marker, [FORMAT_KEY]: 'x' })).toEqual({ ok: false, reason: 'tag', newer: null });
        expect(readFormat('elements', { ...marker, [FORMAT_KEY]: 0 })).toEqual({ ok: false, reason: 'tag', newer: null });
        expect(readFormat('elements', { ...marker, [FORMAT_KEY]: FORMAT_VERSION + 21 })).toEqual({ ok: false, reason: 'tag', newer: null });
    });

    it('tell a failed migration step from a broken tag (it may be fixed by a later release)', () => {
        const failing: Record<number, ProjectStep> = { 1: { entity: { elements: () => {
            throw new Error('step bug');
        } } } };
        expect(readFormat('elements', marker, 2, failing)).toEqual({ ok: false, reason: 'migration', newer: null });
        expect(readFormat('elements', { ...marker, [FORMAT_KEY]: 1 }, 3, future)).toEqual({ ok: false, reason: 'migration', newer: null });
    });
});

describe('queued changes across an app update', () => {
    const row: { collection: string; data: unknown; prev: unknown; unacked?: unknown[]; formatVersion?: number } = { collection: 'elements', data: marker, prev: { ...marker, label: 'Old' }, unacked: [{ ...marker, label: 'Sent' }] };

    it('are migrated with data, base and unacknowledged copies', () => {
        const result = migrateQueued(row, 2, future);
        expect(result && !('newer' in result) && result.changed).toBe(true);
        if (result && !('newer' in result)) {
            expect(result.row.data).toEqual({ ...marker, title: 'Alpha' });
            expect(result.row.prev).toEqual({ ...marker, label: 'Old', title: 'Old' });
            expect(result.row.unacked).toEqual([{ ...marker, label: 'Sent', title: 'Sent' }]);
            expect(result.row.formatVersion).toBe(2);
        }
    });

    it('stay as they are in the current format, deletions included', () => {
        expect(migrateQueued({ ...row, formatVersion: FORMAT_VERSION })).toEqual({ row: { ...row, formatVersion: FORMAT_VERSION }, changed: false });
        const deletion = migrateQueued({ collection: 'elements', data: null, prev: marker }, 2, future);
        expect(deletion && !('newer' in deletion) ? deletion.row.data : 'x').toBeNull();
    });

    it('lose stray tags that 1.0.0-alpha.1 kept in its entities', () => {
        const tagged = { ...row, formatVersion: FORMAT_VERSION, data: { ...marker, [FORMAT_KEY]: 1 }, prev: { ...marker, [FORMAT_KEY]: 1 }, unacked: [{ ...marker, [FORMAT_KEY]: 1 }] };
        const result = migrateQueued(tagged);
        expect(result && !('newer' in result) && result.changed).toBe(true);
        if (result && !('newer' in result)) {
            expect(result.row.data).toEqual(marker);
            expect(result.row.prev).toEqual(marker);
            expect(result.row.unacked).toEqual([marker]);
        }
    });

    it('from a newer app (after going back a version) are held', () => {
        expect(migrateQueued({ ...row, formatVersion: FORMAT_VERSION + 1 })).toEqual({ newer: FORMAT_VERSION + 1 });
    });
});
