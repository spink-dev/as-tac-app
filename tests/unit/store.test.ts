import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../../src/core/model/factory';
import { ProjectSchema, type Marker } from '../../src/core/model/schema';
import { useProject } from '../../src/core/store/project';
import { applyOps, diffProjects } from '../../src/core/store/diff';

function marker(id: string): Marker {
    return { kind: 'marker', id, pos: [11.82, 52.38], type: 'unit', label: id };
}

describe('project store', () => {
    beforeEach(() => {
        useProject.getState().load(createProject({ name: 'Test', areaId: 'mahlwinkel' }));
    });

    it('creates a schema-valid project', () => {
        expect(ProjectSchema.safeParse(useProject.getState().project).success).toBe(true);
    });

    it('undoes and redoes mutations', () => {
        const { mutate } = useProject.getState();
        mutate('add', (draft) => {
            draft.elements.push(marker('a'));
        });
        mutate('add', (draft) => {
            draft.elements.push(marker('b'));
        });
        expect(useProject.getState().project?.elements).toHaveLength(2);
        expect(useProject.getState().undo()).toBe('add');
        expect(useProject.getState().project?.elements).toHaveLength(1);
        useProject.getState().redo();
        expect(useProject.getState().project?.elements.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('coalesces keyed edits into one undo step', () => {
        const { mutate } = useProject.getState();
        mutate('add', (draft) => {
            draft.elements.push(marker('a'));
        });
        for (const label of ['A', 'Al', 'Alp', 'Alpha']) {
            mutate('label', (draft) => {
                draft.elements[0].label = label;
            }, { key: 'label:a' });
        }
        expect(useProject.getState().past).toHaveLength(2);
        useProject.getState().undo();
        expect(useProject.getState().project?.elements[0].label).toBe('a');
    });

    it('refuses local edits on read-only copies but accepts remote ones', () => {
        useProject.getState().setReadOnly('viewer');
        expect(useProject.getState().mutate('x', (draft) => {
            draft.name = 'nope';
        })).toBe(false);
        expect(useProject.getState().mutate('x', (draft) => {
            draft.name = 'remote';
        }, { remote: true })).toBe(true);
        expect(useProject.getState().project?.name).toBe('remote');
    });
});

describe('entity diff', () => {
    it('emits upserts, deletes and meta changes that replay to the same state', () => {
        const store = useProject.getState();
        store.load(createProject({ name: 'Diff', areaId: null }));
        store.mutate('seed', (draft) => {
            draft.elements.push(marker('a'), marker('b'));
        });
        const before = useProject.getState().project!;
        store.mutate('edit', (draft) => {
            draft.elements[0].label = 'changed';
            draft.elements.splice(1, 1);
            draft.elements.push(marker('c'));
            draft.name = 'Renamed';
        });
        const after = useProject.getState().project!;
        const ops = diffProjects(before, after);
        expect(ops.map((op) => `${op.collection}:${op.entityId}:${op.data === null ? 'del' : 'put'}`).sort()).toEqual(
            ['elements:a:put', 'elements:b:del', 'elements:c:put', 'meta:meta:put'].sort(),
        );
        const replay = structuredClone(before);
        applyOps(replay, ops);
        expect(replay.elements.map((e) => e.id).sort()).toEqual(['a', 'c']);
        expect(replay.name).toBe('Renamed');
    });
});
