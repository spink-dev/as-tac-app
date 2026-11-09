import type { GeoJSONSource, LayerSpecification, Map as MlMap } from 'maplibre-gl';
import { EMPTY_FC, FONT } from './basemap';
import type { Palette } from './palette';
import type { PlanCollections } from './planFeatures';

export const PLAN_SOURCES = ['plan-zones', 'plan-lines', 'plan-points', 'plan-labels', 'plan-ink', 'grid', 'tracks', 'gps', 'nav', 'draft', 'edit'] as const;
export type PlanSource = typeof PLAN_SOURCES[number];

/** Layers that can be picked by tapping. Order: topmost first. */
export const HIT_LAYERS = ['plan-markers', 'plan-text', 'plan-line-hit', 'plan-zone-line-hit', 'plan-zone-fill'];
export const INK_LAYER = 'plan-ink';
export const FIRST_PLAN_LAYER = 'grid-line';

const op = ['coalesce', ['get', 'op'], 1];
const isSel = ['==', ['get', 'sel'], 1];

function layers(p: Palette): LayerSpecification[] {
    const w = ['coalesce', ['get', 'width'], 3];
    const widthPlus = (extra: number) => ['interpolate', ['linear'], ['zoom'], 12, ['+', ['*', w, 0.7], extra], 16, ['+', w, extra], 19, ['+', ['*', w, 1.5], extra]];
    const lineWidth = widthPlus(0);
    const lineLayer = (id: string, dash: string, dasharray?: number[]): LayerSpecification => ({
        id, type: 'line', source: 'plan-lines', filter: ['==', ['get', 'dash'], dash] as never,
        layout: { 'line-cap': dash === 'solid' ? 'round' : 'butt', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'] as never, 'line-width': lineWidth as never, 'line-opacity': op as never, ...(dasharray ? { 'line-dasharray': dasharray } : {}) },
    });
    return [
        {
            id: 'grid-line', type: 'line', source: 'grid',
            paint: { 'line-color': p.grid, 'line-width': ['case', ['==', ['get', 'major'], 1], 1.4, 0.8] as never, 'line-opacity': 0.55 },
        },
        {
            id: 'grid-label', type: 'symbol', source: 'grid',
            layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 11, 'symbol-spacing': 260, 'text-keep-upright': true },
            paint: { 'text-color': p.gridLabel, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
        },
        {
            id: 'plan-zone-fill', type: 'fill', source: 'plan-zones',
            paint: { 'fill-color': ['get', 'color'] as never, 'fill-opacity': ['*', ['get', 'fillOp'], op, ['case', ['==', ['get', 'pattern'], ''], 1, 0.35]] as never },
        },
        {
            id: 'plan-zone-pattern', type: 'fill', source: 'plan-zones', filter: ['!=', ['get', 'pattern'], ''] as never,
            paint: { 'fill-pattern': ['get', 'pattern'] as never, 'fill-opacity': ['*', 0.6, op] as never },
        },
        {
            id: 'plan-zone-sel', type: 'line', source: 'plan-zones', filter: isSel as never,
            paint: { 'line-color': p.selection, 'line-width': 8, 'line-opacity': 0.35, 'line-blur': 1 },
        },
        {
            id: 'plan-zone-line', type: 'line', source: 'plan-zones', filter: ['==', ['get', 'dash'], 'solid'] as never,
            layout: { 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'] as never, 'line-width': 2.2, 'line-opacity': op as never },
        },
        {
            id: 'plan-zone-line-dash', type: 'line', source: 'plan-zones', filter: ['==', ['get', 'dash'], 'dash'] as never,
            paint: { 'line-color': ['get', 'color'] as never, 'line-width': 2.4, 'line-opacity': op as never, 'line-dasharray': [3, 2] },
        },
        { id: 'plan-zone-line-hit', type: 'line', source: 'plan-zones', paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 } },
        {
            id: 'tracks-line', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': p.gps, 'line-width': 2.5, 'line-opacity': 0.85, 'line-dasharray': [1, 1.6] },
        },
        {
            id: 'plan-line-sel', type: 'line', source: 'plan-lines', filter: isSel as never, layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': p.selection, 'line-width': widthPlus(9) as never, 'line-opacity': 0.35, 'line-blur': 1 },
        },
        {
            id: 'plan-line-case', type: 'line', source: 'plan-lines', filter: ['!=', ['get', 'dash'], 'dot'] as never, layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': p.labelHalo, 'line-width': widthPlus(2.5) as never, 'line-opacity': ['*', 0.85, op] as never },
        },
        lineLayer('plan-line', 'solid'),
        lineLayer('plan-line-dash', 'dash', [2.5, 1.6]),
        lineLayer('plan-line-long', 'long', [5, 2]),
        lineLayer('plan-line-dot', 'dot', [0.6, 1.8]),
        { id: 'plan-line-hit', type: 'line', source: 'plan-lines', paint: { 'line-color': '#000', 'line-width': 22, 'line-opacity': 0 } },
        {
            id: 'plan-line-arrows', type: 'symbol', source: 'plan-lines', filter: ['==', ['get', 'arrow'], 1] as never,
            layout: {
                'symbol-placement': 'line', 'symbol-spacing': 110, 'icon-image': ['concat', 'arrow|', ['get', 'color']] as never,
                'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map', 'icon-size': 0.9,
            },
            paint: { 'icon-opacity': op as never },
        },
        {
            id: 'plan-ink', type: 'line', source: 'plan-ink', layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'] as never, 'line-width': ['get', 'width'] as never, 'line-opacity': ['coalesce', ['get', 'op'], 0.95] as never },
        },
        {
            id: 'plan-heads', type: 'symbol', source: 'plan-points', filter: ['==', ['get', 'role'], 'head'] as never,
            layout: {
                'icon-image': ['get', 'icon'] as never, 'icon-rotate': ['get', 'rot'] as never, 'icon-rotation-alignment': 'map',
                'icon-allow-overlap': true, 'icon-ignore-placement': true,
            },
            paint: { 'icon-opacity': op as never },
        },
        {
            id: 'plan-point-sel', type: 'circle', source: 'plan-points', filter: ['all', isSel, ['!=', ['get', 'role'], 'head']] as never,
            paint: { 'circle-radius': 24, 'circle-color': p.selection, 'circle-opacity': 0.22, 'circle-stroke-color': p.selection, 'circle-stroke-width': 2 },
        },
        {
            id: 'plan-markers', type: 'symbol', source: 'plan-points', filter: ['==', ['get', 'role'], 'marker'] as never,
            layout: {
                'icon-image': ['get', 'icon'] as never, 'icon-rotate': ['get', 'rot'] as never, 'icon-allow-overlap': true, 'icon-ignore-placement': false,
                'text-field': ['get', 'text'] as never, 'text-font': FONT, 'text-size': ['get', 'size'] as never, 'text-anchor': 'top', 'text-offset': [0, 1.35],
                'text-optional': true, 'text-max-width': 10, 'text-padding': 2,
                'symbol-sort-key': ['-', 0, ['get', 'sel']] as never,
            },
            paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6, 'icon-opacity': op as never, 'text-opacity': op as never },
        },
        {
            id: 'plan-text', type: 'symbol', source: 'plan-points', filter: ['==', ['get', 'role'], 'text'] as never,
            layout: {
                'text-field': ['get', 'text'] as never, 'text-font': FONT, 'text-size': ['get', 'size'] as never, 'text-allow-overlap': true, 'text-max-width': 14,
            },
            paint: {
                'text-color': ['case', ['==', ['get', 'color'], ''], p.label, ['get', 'color']] as never,
                'text-halo-color': p.labelHalo, 'text-halo-width': 2, 'text-opacity': op as never,
            },
        },
        {
            id: 'plan-labels', type: 'symbol', source: 'plan-labels',
            layout: {
                'text-field': ['get', 'text'] as never, 'text-font': FONT, 'text-size': ['get', 'size'] as never, 'text-padding': 3, 'text-max-width': 12,
                'symbol-sort-key': ['case', ['==', ['get', 'role'], 'zone'], 0, ['==', ['get', 'role'], 'route'], 1, 2] as never,
                'text-offset': ['match', ['get', 'role'], 'route', ['literal', [0, -1.4]], 'leg', ['literal', [0, 1.2]], ['literal', [0, 0]]] as never,
            },
            paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.8, 'text-opacity': op as never },
        },
        {
            id: 'nav-line', type: 'line', source: 'nav', layout: { 'line-cap': 'round' },
            paint: { 'line-color': p.gps, 'line-width': 3, 'line-dasharray': [1.2, 1.4], 'line-opacity': 0.9 },
        },
        {
            id: 'gps-accuracy', type: 'fill', source: 'gps', filter: ['==', ['get', 'role'], 'accuracy'] as never,
            paint: { 'fill-color': p.gps, 'fill-opacity': ['case', ['==', ['get', 'stale'], 1], 0.06, 0.14] as never, 'fill-outline-color': p.gps },
        },
        {
            id: 'gps-heading', type: 'symbol', source: 'gps', filter: ['==', ['get', 'role'], 'heading'] as never,
            layout: { 'icon-image': 'head|' + p.gps, 'icon-rotate': ['get', 'rot'] as never, 'icon-rotation-alignment': 'map', 'icon-offset': [10, 0], 'icon-allow-overlap': true, 'icon-size': 1.1 },
        },
        {
            id: 'gps-dot', type: 'circle', source: 'gps', filter: ['==', ['get', 'role'], 'dot'] as never,
            paint: {
                'circle-radius': 8, 'circle-color': ['case', ['==', ['get', 'stale'], 1], '#8a9097', p.gps] as never,
                'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3,
            },
        },
        {
            id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'] as never,
            paint: { 'fill-color': p.draft, 'fill-opacity': 0.14 },
        },
        {
            id: 'draft-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'] as never,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['coalesce', ['get', 'color'], p.draft] as never, 'line-width': ['coalesce', ['get', 'width'], 3] as never, 'line-dasharray': [2, 1.2] },
        },
        {
            id: 'draft-label', type: 'symbol', source: 'draft', filter: ['has', 'text'] as never,
            layout: { 'text-field': ['get', 'text'] as never, 'text-font': FONT, 'text-size': 12, 'text-offset': [0, -1.4], 'text-allow-overlap': true },
            paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 2 },
        },
        {
            id: 'draft-points', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'] as never,
            paint: { 'circle-radius': ['case', ['==', ['get', 'first'], 1], 8, 5] as never, 'circle-color': p.handle, 'circle-stroke-color': p.draft, 'circle-stroke-width': 2.5 },
        },
        {
            id: 'edit-line', type: 'line', source: 'edit', filter: ['==', ['geometry-type'], 'LineString'] as never,
            paint: { 'line-color': p.handleLine, 'line-width': 1.5, 'line-dasharray': [2, 2] },
        },
        {
            id: 'edit-handles', type: 'circle', source: 'edit', filter: ['==', ['geometry-type'], 'Point'] as never,
            paint: {
                'circle-radius': ['match', ['get', 'role'], 'mid', 5, 'move', 9, 'corner', 9, 7] as never,
                'circle-color': ['match', ['get', 'role'], 'mid', p.handleLine, 'move', p.handleLine, p.handle] as never,
                'circle-opacity': ['match', ['get', 'role'], 'mid', 0.6, 1] as never,
                'circle-stroke-color': ['match', ['get', 'role'], 'move', p.handle, p.handleLine] as never,
                'circle-stroke-width': 2.5,
            },
        },
    ];
}

export function addPlanLayers(map: MlMap, p: Palette) {
    for (const source of PLAN_SOURCES) {
        if (!map.getSource(source)) {
            map.addSource(source, { type: 'geojson', data: EMPTY_FC, tolerance: source === 'plan-ink' ? 0.2 : 0.3 });
        }
    }
    for (const layer of layers(p)) {
        if (!map.getLayer(layer.id)) {
            map.addLayer(layer);
        }
    }
}

export function applyPlanPalette(map: MlMap, p: Palette) {
    for (const layer of layers(p)) {
        if (!map.getLayer(layer.id)) {
            continue;
        }
        const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
        for (const [key, value] of Object.entries(paint)) {
            map.setPaintProperty(layer.id, key as never, value as never);
        }
        const layout = (layer as { layout?: Record<string, unknown> }).layout ?? {};
        if ('icon-image' in layout && layer.id === 'gps-heading') {
            map.setLayoutProperty(layer.id, 'icon-image', layout['icon-image'] as never);
        }
    }
}

export function setSourceData(map: MlMap, source: PlanSource | 'osm', data: GeoJSON.FeatureCollection | GeoJSON.Feature) {
    (map.getSource(source) as GeoJSONSource | undefined)?.setData(data);
}

export function setPlanData(map: MlMap, collections: PlanCollections) {
    setSourceData(map, 'plan-zones', collections.zones);
    setSourceData(map, 'plan-lines', collections.lines);
    setSourceData(map, 'plan-points', collections.points);
    setSourceData(map, 'plan-labels', collections.labels);
    setSourceData(map, 'plan-ink', collections.ink);
}
