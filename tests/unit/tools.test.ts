import { describe, expect, it } from 'vitest';
import { insertVertex, moveVertex, removeVertex, setRadius, simplify, translateElement } from '../../src/core/model/geometry';
import { bindingFor, eventCombo, findConflict, formatCombo, SHORTCUTS } from '../../src/core/shortcuts/registry';
import type { Route, Zone } from '../../src/core/model/schema';
import { distanceM } from '../../src/core/geo/geo';

const route: Route = { kind: 'route', id: 'r', points: [[8, 47], [8.01, 47], [8.02, 47.01]], style: 'planned', arrow: true };
const circle: Zone = { kind: 'zone', id: 'z', shape: { type: 'circle', center: [8, 47], radiusM: 100 }, category: 'ao', fillOpacity: 0.2, labelPos: [8.001, 47.001] };

describe('element geometry', () => {
    it('translates every coordinate including label positions', () => {
        const moved = translateElement(circle, 0.01, -0.01);
        expect(moved.shape.type === 'circle' && moved.shape.center).toEqual([8.01, 46.99]);
        expect(moved.labelPos).toEqual([8.011, 46.991]);
        expect(circle.shape.type === 'circle' && circle.shape.center).toEqual([8, 47]);
    });

    it('moves, inserts and removes vertices without mutating the input', () => {
        const moved = moveVertex(route, 1, [8.011, 47.001]);
        expect(moved.points[1]).toEqual([8.011, 47.001]);
        expect(route.points[1]).toEqual([8.01, 47]);
        const inserted = insertVertex(route, 0, [8.005, 47]);
        expect(inserted.points).toHaveLength(4);
        expect(inserted.points[1]).toEqual([8.005, 47]);
        expect(removeVertex(route, 1).points).toHaveLength(2);
        expect(removeVertex(removeVertex(route, 1), 0).points).toHaveLength(2);
    });

    it('sets a circle radius from an edge point', () => {
        const edge: [number, number] = [8.002, 47];
        const resized = setRadius(circle, edge);
        expect(resized.shape.type === 'circle' && resized.shape.radiusM).toBeCloseTo(distanceM([8, 47], edge), 3);
    });

    it('simplifies near-straight strokes but keeps corners', () => {
        const points: [number, number][] = [];
        for (let i = 0; i <= 20; i++) {
            points.push([i, i % 2 === 0 ? 0 : 0.3]);
        }
        points.push([20, 20]);
        const kept = simplify(points, 1);
        expect(kept[0]).toBe(0);
        expect(kept[kept.length - 1]).toBe(points.length - 1);
        expect(kept).toContain(20);
        expect(kept.length).toBeLessThan(6);
    });
});

describe('shortcut registry', () => {
    const key = (init: KeyboardEventInit & { key: string }) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

    it('normalises events', () => {
        expect(eventCombo(key({ key: 'z', ctrlKey: true }))).toBe('mod+z');
        expect(eventCombo(key({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('mod+shift+z');
        expect(eventCombo(key({ key: 'S', shiftKey: true }))).toBe('shift+s');
        expect(eventCombo(key({ key: '?', shiftKey: true }))).toBe('shift+?');
        expect(eventCombo(key({ key: '3' }))).toBe('3');
    });

    it('has unique default bindings and no bare digit bindings', () => {
        const combos = SHORTCUTS.map((s) => s.keys);
        expect(new Set(combos).size).toBe(combos.length);
        expect(combos.some((c) => /^[0-9]$/.test(c))).toBe(false);
    });

    it('honours overrides and reports conflicts', () => {
        const overrides = { 'tool.marker': 'q' };
        expect(bindingFor('tool.marker', overrides)).toBe('q');
        expect(findConflict('tool.route', 'q', overrides)?.id).toBe('tool.marker');
        expect(findConflict('tool.route', 'r', overrides)).toBeUndefined();
        expect(formatCombo('mod+shift+z')).toMatch(/Z$/);
    });
});
