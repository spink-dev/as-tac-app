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

describe('review regressions (P0-fix)', () => {
    beforeEach(() => {
        useProject.getState().load(createProject({ name: 'R', areaId: null }));
        useProject.getState().mutate('seed', (draft) => {
            draft.elements.push(marker('a'), marker('b'), marker('c'));
        });
    });

    it('treats no-op edits as no-ops and keeps redo', () => {
        const store = useProject.getState();
        store.mutate('rename b', (draft) => {
            draft.elements[1].label = 'Bravo';
        });
        useProject.getState().undo();
        expect(useProject.getState().future).toHaveLength(1);
        expect(useProject.getState().mutate('noop', (draft) => {
            draft.name = draft.name;
        })).toBe(false);
        expect(useProject.getState().future).toHaveLength(1);
    });

    it('keeps undo correct after a remote delete shifts indexes', () => {
        const store = useProject.getState();
        store.mutate('rename b', (draft) => {
            draft.elements[1].label = 'Bravo';
        });
        store.mutate('remote delete a', (draft) => {
            draft.elements.splice(0, 1);
        }, { remote: true });
        useProject.getState().undo();
        const els = useProject.getState().project!.elements;
        expect(els.map((e) => [e.id, e.label])).toEqual([['b', 'b'], ['c', 'c']]);
    });

    it('does not overwrite an entity a peer changed after my edit', () => {
        const store = useProject.getState();
        store.mutate('rename b', (draft) => {
            draft.elements[1].label = 'Bravo';
        });
        store.mutate('peer', (draft) => {
            draft.elements[1] = { ...draft.elements[1], label: 'Peer' };
        }, { remote: true });
        useProject.getState().undo();
        expect(useProject.getState().project!.elements[1].label).toBe('Peer');
    });

    it('syncs reorders and repairs orphaned layers', () => {
        const store = useProject.getState();
        store.mutate('layer', (draft) => {
            draft.layers.push({ id: 'L2', name: 'Two', visible: true, opacity: 1, locked: false });
        });
        const before = useProject.getState().project!;
        store.mutate('reorder', (draft) => {
            draft.layers.reverse();
        });
        const after = useProject.getState().project!;
        const ops = diffProjects(before, after);
        expect(ops.some((op) => op.entityId === '__order')).toBe(true);
        const peer = structuredClone(before);
        applyOps(peer, ops);
        expect(peer.layers.map((l) => l.id)).toEqual(after.layers.map((l) => l.id));

        const orphan = structuredClone(after);
        orphan.elements.push({ ...marker('x'), layerId: 'L2' });
        applyOps(orphan, [{ collection: 'layers', entityId: 'L2', data: null }]);
        expect(ProjectSchema.safeParse(orphan).success).toBe(true);
    });
});

describe('review regressions (P0-fix2)', () => {
    beforeEach(() => {
        useProject.getState().load(createProject({ name: 'R2', areaId: null }));
        useProject.getState().mutate('seed', (draft) => {
            draft.layers.push({ id: 'L2', name: 'Two', visible: true, opacity: 1, locked: false });
            draft.elements.push(marker('a'), marker('b'), marker('c'), { ...marker('x'), layerId: 'L2' });
        });
    });

    it('undo and redo survive a peer deleting the layer of a restored entity', () => {
        const store = useProject.getState();
        store.mutate('delete x', (draft) => {
            draft.elements.splice(3, 1);
        });
        store.mutate('peer deletes L2', (draft) => {
            draft.layers.splice(1, 1);
        }, { remote: true });
        expect(() => useProject.getState().undo()).not.toThrow();
        const x = useProject.getState().project!.elements.find((e) => e.id === 'x');
        expect(x?.layerId).toBe(useProject.getState().project!.layers[0].id);
        expect(() => useProject.getState().redo()).not.toThrow();
    });

    it('does not coalesce across a peer change', () => {
        const store = useProject.getState();
        store.mutate('label', (draft) => {
            draft.elements[0].label = 'A1';
        }, { key: 'label:a' });
        store.mutate('peer move', (draft) => {
            draft.elements[0] = { ...draft.elements[0], pos: [11.9, 52.4] } as never;
        }, { remote: true });
        store.mutate('label', (draft) => {
            draft.elements[0].label = 'A12';
        }, { key: 'label:a' });
        useProject.getState().undo();
        const a = useProject.getState().project!.elements[0] as Marker;
        expect(a.pos).toEqual([11.9, 52.4]);
        expect(a.label).toBe('A1');
    });

    it('does not override a peer reorder when undoing a middle delete', () => {
        const store = useProject.getState();
        store.mutate('delete b', (draft) => {
            draft.elements.splice(1, 1);
        });
        store.mutate('peer reorder', (draft) => {
            draft.elements.reverse();
        }, { remote: true });
        useProject.getState().undo();
        expect(useProject.getState().project!.elements.map((e) => e.id)).toEqual(['x', 'c', 'a', 'b']);
    });
});
