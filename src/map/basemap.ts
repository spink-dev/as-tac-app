import type { LayerSpecification, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { Palette } from './palette';

export const FONT = ['Noto Sans Regular'];
export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const PATHS = ['path', 'footway', 'cycleway', 'steps', 'bridleway', 'pedestrian', 'platform'];
const MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'];
const MINOR = ['tertiary', 'tertiary_link', 'residential', 'unclassified', 'living_street', 'service', 'road'];

type Expr = unknown[];

const isPolygon: Expr = ['==', ['geometry-type'], 'Polygon'];
const isLine: Expr = ['==', ['geometry-type'], 'LineString'];
const tag = (key: string): Expr => ['get', key];
const tagIn = (key: string, values: string[]): Expr => ['in', ['coalesce', ['get', key], ''], ['literal', values]];

function landcoverColor(p: Palette): Expr {
    return [
        'case',
        ['any', ['==', tag('natural'), 'wood'], ['==', tag('landuse'), 'forest']], p.wood,
        ['any', tagIn('natural', ['scrub', 'heath', 'tree_row']), tagIn('landuse', ['orchard', 'vineyard', 'plant_nursery'])], p.scrub,
        ['any', tagIn('natural', ['grassland', 'wetland']), tagIn('landuse', ['meadow', 'grass', 'village_green', 'recreation_ground', 'cemetery', 'allotments']), tagIn('leisure', ['park', 'pitch', 'garden', 'playground'])], p.grass,
        tagIn('landuse', ['farmland', 'farmyard', 'animal_keeping', 'greenhouse_horticulture']), p.farm,
        tagIn('landuse', ['industrial', 'commercial', 'retail', 'military', 'construction', 'railway', 'brownfield']), p.industrial,
        tagIn('landuse', ['residential']), p.residential,
        p.background,
    ];
}

/** Base style. Plan, image and tool layers are added on top by the map controller. */
export function baseStyle(p: Palette, glyphs: string): StyleSpecification {
    return {
        version: 8,
        glyphs,
        sources: {
            osm: { type: 'geojson', data: EMPTY_FC, maxzoom: 16, tolerance: 0.45, buffer: 96, attribution: '© OpenStreetMap-Mitwirkende' },
        },
        layers: basemapLayers(p),
    };
}

export function basemapLayers(p: Palette): LayerSpecification[] {
    const water: Expr = ['any', ['==', tag('natural'), 'water'], tagIn('waterway', ['riverbank', 'dock']), tagIn('landuse', ['reservoir', 'basin'])];
    return [
        { id: 'bg', type: 'background', paint: { 'background-color': p.background } },
        {
            id: 'landcover', type: 'fill', source: 'osm',
            filter: ['all', isPolygon, ['!', ['has', 'building']], ['!', water]] as never,
            paint: { 'fill-color': landcoverColor(p) as never, 'fill-antialias': false },
        },
        { id: 'water', type: 'fill', source: 'osm', filter: ['all', isPolygon, water] as never, paint: { 'fill-color': p.water } },
        {
            id: 'waterway', type: 'line', source: 'osm', filter: ['all', isLine, ['has', 'waterway']] as never,
            paint: { 'line-color': p.waterLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 17, 3] },
        },
        {
            id: 'building', type: 'fill', source: 'osm', minzoom: 13, filter: ['all', isPolygon, ['has', 'building']] as never,
            paint: { 'fill-color': p.building, 'fill-outline-color': p.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 15, 1] },
        },
        {
            id: 'barrier', type: 'line', source: 'osm', minzoom: 15, filter: ['all', isLine, ['has', 'barrier']] as never,
            paint: { 'line-color': p.barrier, 'line-width': 1, 'line-dasharray': [3, 2] },
        },
        {
            id: 'rail', type: 'line', source: 'osm', filter: ['all', isLine, ['has', 'railway']] as never,
            paint: { 'line-color': p.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 2.5], 'line-dasharray': [4, 2] },
        },
        {
            id: 'track', type: 'line', source: 'osm', filter: ['all', isLine, ['==', tag('highway'), 'track']] as never,
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': p.track, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 15, 2, 18, 4], 'line-dasharray': [3, 1.5] },
        },
        {
            id: 'path', type: 'line', source: 'osm', minzoom: 13, filter: ['all', isLine, tagIn('highway', PATHS)] as never,
            layout: { 'line-cap': 'round' },
            paint: { 'line-color': p.path, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 16, 1.4, 18, 2.6], 'line-dasharray': [1.5, 1.5] },
        },
        {
            id: 'road-case', type: 'line', source: 'osm', filter: ['all', isLine, tagIn('highway', [...MAJOR, ...MINOR])] as never,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': p.roadCase, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 15, 5, 18, 14] },
        },
        {
            id: 'road', type: 'line', source: 'osm', filter: ['all', isLine, tagIn('highway', MINOR)] as never,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': p.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 3.4, 18, 11] },
        },
        {
            id: 'road-major', type: 'line', source: 'osm', filter: ['all', isLine, tagIn('highway', MAJOR)] as never,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': p.major, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 15, 4, 18, 12] },
        },
        {
            id: 'power', type: 'circle', source: 'osm', minzoom: 13, filter: ['==', tag('power'), 'generator'] as never,
            paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 5], 'circle-color': p.poi, 'circle-stroke-color': p.labelHalo, 'circle-stroke-width': 1 },
        },
        {
            id: 'label-road', type: 'symbol', source: 'osm', minzoom: 14.5, filter: ['all', isLine, ['has', 'name'], ['has', 'highway']] as never,
            layout: {
                'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10.5, 18, 13],
                'text-max-angle': 30, 'symbol-spacing': 320, 'text-padding': 4,
            },
            paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4 },
        },
        {
            id: 'label-water', type: 'symbol', source: 'osm', minzoom: 13, filter: ['all', ['has', 'name'], ['any', water, ['has', 'waterway']]] as never,
            layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11, 'symbol-placement': 'point', 'text-padding': 6 },
            paint: { 'text-color': p.waterLine, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
        },
        {
            id: 'label-poi', type: 'symbol', source: 'osm', minzoom: 16, filter: ['all', ['has', 'name'], ['any', ['has', 'amenity'], ['has', 'tourism'], ['has', 'leisure'], ['has', 'building']]] as never,
            layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 10.5, 'text-max-width': 8, 'text-padding': 6, 'text-optional': true },
            paint: { 'text-color': p.poi, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.2 },
        },
        {
            id: 'label-place', type: 'symbol', source: 'osm', minzoom: 11, filter: ['all', ['has', 'name'], ['has', 'place']] as never,
            layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 15, 15], 'text-padding': 8 },
            paint: { 'text-color': p.label, 'text-halo-color': p.labelHalo, 'text-halo-width': 1.6 },
        },
    ];
}

const LABEL_LAYERS = ['label-road', 'label-water', 'label-poi', 'label-place'];

/** Switch appearance without recreating the map: drafts, view and selection survive. */
export function applyBasemapPalette(map: MlMap, p: Palette) {
    for (const layer of basemapLayers(p)) {
        if (!map.getLayer(layer.id)) {
            continue;
        }
        const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
        for (const [key, value] of Object.entries(paint)) {
            map.setPaintProperty(layer.id, key as never, value as never);
        }
    }
}

export function setBasemapLabels(map: MlMap, visible: boolean) {
    for (const id of LABEL_LAYERS) {
        if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
    }
}
