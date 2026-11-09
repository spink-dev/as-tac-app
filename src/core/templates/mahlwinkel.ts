import fieldmaps from '../../data/mahlwinkel-fieldmaps.json';
import deCorrection from '../../data/dark-emergency-correction.json';
import { createLayer, createProject, uid } from '../model/factory';
import type { Element, LngLat, Project, ZoneCategory, ZonePattern } from '../model/schema';
import { boundsOf, centroid } from '../geo/geo';

/**
 * Event templates for the Mahlwinkel airsoft site.
 * Source: FieldMaps by @rwolffgang (https://github.com/rwolffgang/FieldMaps), commit 2998bb6,
 * converted to WGS84 [lng, lat]. Dark Emergency uses the as-tac r2 correction (safe zones, play area).
 * This is reference data, not a statement about the current official event layout.
 */
type LatLng = [number, number];
interface FmZone {
    id: string;
    name: string;
    color: string;
    style?: string;
    points: LatLng[];
}
interface FmEvent {
    id: string;
    name: string;
    poiNames: Record<string, string>;
    playArea: LatLng[];
    zones: FmZone[];
    headquarters: { id: string; name: string; lat: number; lng: number; color: string }[];
    lines: { id: string; name: string; color: string; points: LatLng[] }[];
}

const data = fieldmaps as unknown as { source: string; commit: string; points: { id: string; lat: number; lng: number }[]; events: FmEvent[] };
const correction = deCorrection as unknown as { edition: string; playArea: LatLng[]; zones: FmZone[] };

const swap = (p: LatLng): LngLat => [p[1], p[0]];

export interface EventTemplate {
    id: string;
    siteId: 'mahlwinkel';
    name: string;
    areaId: 'mahlwinkel';
    /** Counts for the template's short description (worded in the UI language). */
    counts: { buildings: number; hq: number; zones: number };
}

export const MAHLWINKEL_EVENTS: EventTemplate[] = data.events.map((event) => ({
    id: event.id,
    siteId: 'mahlwinkel',
    name: event.name,
    areaId: 'mahlwinkel',
    counts: { buildings: Object.keys(event.poiNames).length, hq: event.headquarters.length, zones: event.zones.length },
}));

function zoneStyle(zone: FmZone): { category: ZoneCategory; pattern: ZonePattern } {
    const name = zone.name.toLowerCase();
    if (name.includes('safe')) {
        return { category: 'safe', pattern: 'hatch' };
    }
    if (name.includes('zivil')) {
        return { category: 'civil', pattern: 'solid' };
    }
    if (name.includes('sperr')) {
        return { category: 'nogo', pattern: 'cross' };
    }
    if (zone.style === 'biohazard') {
        return { category: 'danger', pattern: 'hatch' };
    }
    return { category: 'custom', pattern: 'solid' };
}

export function buildMahlwinkelProject(eventId: string, name?: string): Project {
    const event = data.events.find((candidate) => candidate.id === eventId);
    if (!event) {
        throw new Error('template-unknown');
    }
    const corrected = event.id === 'de';
    const playArea = (corrected ? correction.playArea : event.playArea).map(swap);
    const zones = corrected ? correction.zones : event.zones;
    const project = createProject({ name: name ?? `Mahlwinkel · ${event.name}`, areaId: 'mahlwinkel' });
    const site = createLayer('Gelände');
    site.locked = true;
    const eventLayer = createLayer('Event');
    eventLayer.locked = true;
    const plan = project.layers[0];
    project.layers = [site, eventLayer, plan];
    const bounds = boundsOf(playArea);
    project.view = { center: centroid([[bounds[0], bounds[1]], [bounds[2], bounds[3]]]), zoom: 15.2, bearing: 0 };
    project.event = {
        siteId: 'mahlwinkel',
        eventId: event.id,
        edition: corrected ? correction.edition : `fieldmaps-${data.commit.slice(0, 7)}`,
        source: `${data.source}, commit ${data.commit}`,
    };
    const elements: Element[] = [];
    elements.push({
        kind: 'zone', id: uid('el'), layerId: eventLayer.id, label: 'Spielfeld', category: 'ao', pattern: 'none', fillOpacity: 0,
        color: '#c8393f', locked: true, sourceId: `fieldmaps:${event.id}:playArea`, shape: { type: 'polygon', points: playArea },
    });
    for (const zone of zones) {
        const style = zoneStyle(zone);
        elements.push({
            kind: 'zone', id: uid('el'), layerId: eventLayer.id, label: zone.name, category: style.category, pattern: style.pattern,
            fillOpacity: 0.18, color: zone.color, locked: true, sourceId: `fieldmaps:${event.id}:zone:${zone.id}`,
            shape: { type: 'polygon', points: zone.points.map(swap) },
        });
    }
    for (const line of event.lines) {
        elements.push({
            kind: 'route', id: uid('el'), layerId: eventLayer.id, label: line.name, style: 'boundary', arrow: false, color: line.color,
            locked: true, sourceId: `fieldmaps:${event.id}:line:${line.id}`, points: line.points.map(swap),
        });
    }
    for (const hq of event.headquarters) {
        elements.push({
            kind: 'marker', id: uid('el'), layerId: eventLayer.id, type: 'hq', label: hq.name, color: hq.color,
            locked: true, sourceId: `fieldmaps:${event.id}:hq:${hq.id}`, pos: [hq.lng, hq.lat],
        });
    }
    for (const point of data.points) {
        const poiName = event.poiNames[point.id];
        elements.push({
            kind: 'marker', id: uid('el'), layerId: site.id, type: 'poi', label: poiName ? `${point.id} ${poiName}` : point.id,
            locked: true, sourceId: `fieldmaps:poi:${point.id}`, pos: [point.lng, point.lat],
        });
    }
    project.elements = elements;
    return project;
}

export const FIELDMAPS_CREDIT = `${data.source} · commit ${data.commit.slice(0, 7)}`;
