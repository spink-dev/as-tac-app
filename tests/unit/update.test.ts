import { describe, expect, it, beforeEach } from 'vitest';
import { compareVersions, isBuildInfo, sameBuild } from '../../src/version';
import { freezeLocalEdits, useProject } from '../../src/core/store/project';
import { createProject } from '../../src/core/model/factory';

class MemoryStorage {
    private map = new Map<string, string>();
    getItem(key: string) {
        return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string) {
        this.map.set(key, String(value));
    }
    removeItem(key: string) {
        this.map.delete(key);
    }
}

describe('versions', () => {
    it('orders releases and pre-releases like semver', () => {
        const ordered = ['0.6.0', '1.0.0-alpha.1', '1.0.0-alpha.2', '1.0.0-alpha.10', '1.0.0-beta.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
        for (let i = 1; i < ordered.length; i++) {
            expect(compareVersions(ordered[i - 1], ordered[i]), `${ordered[i - 1]} < ${ordered[i]}`).toBeLessThan(0);
            expect(compareVersions(ordered[i], ordered[i - 1])).toBeGreaterThan(0);
        }
        expect(compareVersions('1.0.0-alpha.2', '1.0.0-alpha.2')).toBe(0);
        expect(compareVersions('1.0.0-alpha.2+e2e', '1.0.0-alpha.2')).toBe(0);
    });

    it('tells builds apart by version, commit and time', () => {
        const a = { version: '1.0.0-alpha.2', commit: 'abc', date: '2026-11-08T10:00:00.000Z' };
        expect(sameBuild(a, { ...a })).toBe(true);
        expect(sameBuild(a, { ...a, commit: 'abd' })).toBe(false);
        expect(sameBuild(a, { ...a, date: '2026-11-08T10:00:01.000Z' })).toBe(false);
    });

    it('accepts only a plausible version file', () => {
        expect(isBuildInfo({ version: '1.0.0', commit: '', date: '' })).toBe(true);
        expect(isBuildInfo({ version: '', commit: '', date: '' })).toBe(false);
        expect(isBuildInfo({ version: 1, commit: '', date: '' })).toBe(false);
        expect(isBuildInfo({ version: 'x'.repeat(100), commit: '', date: '' })).toBe(false);
        expect(isBuildInfo(null)).toBe(false);
        expect(isBuildInfo('1.0.0')).toBe(false);
    });
});

describe('after an update', () => {
    beforeEach(() => {
        (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
    });

    it('reopens the plan once, with its mode and Streamer Safe profile', async () => {
        const { takeResume } = await import('../../src/core/pwa');
        sessionStorage.setItem('as-tac.resume', JSON.stringify({ projectId: 'p1', mode: 'field', streamer: 'public', at: Date.now() }));
        expect(takeResume()).toEqual({ projectId: 'p1', mode: 'field', streamer: 'public' });
        expect(takeResume()).toBeNull();
    });

    it('ignores stale or malformed resume records', async () => {
        const { takeResume } = await import('../../src/core/pwa');
        sessionStorage.setItem('as-tac.resume', JSON.stringify({ projectId: 'p1', mode: 'field', at: Date.now() - 10 * 60 * 1000 }));
        expect(takeResume()).toBeNull();
        sessionStorage.setItem('as-tac.resume', JSON.stringify({ projectId: 'p1', mode: 'hack', streamer: 'x', at: Date.now() }));
        expect(takeResume()).toEqual({ projectId: 'p1', mode: 'plan', streamer: 'off' });
        sessionStorage.setItem('as-tac.resume', '{broken');
        expect(takeResume()).toBeNull();
    });
});

describe('while an update is applied', () => {
    it('refuses local edits, undo and redo, but still takes remote changes', () => {
        const project = createProject({ name: 'Freeze', areaId: null });
        useProject.getState().load(project, false);
        expect(useProject.getState().mutate('a', (draft) => {
            draft.name = 'Before';
        })).toBe(true);
        freezeLocalEdits();
        expect(useProject.getState().mutate('b', (draft) => {
            draft.name = 'After';
        })).toBe(false);
        expect(useProject.getState().undo()).toBeNull();
        expect(useProject.getState().mutate('remote', (draft) => {
            draft.name = 'Remote';
        }, { remote: true })).toBe(true);
        expect(useProject.getState().project?.name).toBe('Remote');
    });
});
