import data from '../../data/mahlwinkel-fieldmaps.json' with { type: 'json' };
import deCorrection from '../../data/dark-emergency-correction.json' with { type: 'json' };
import { createProject, validateProject, type Coordinate, type Geometry, type PlanElement } from '../../core/projects/model';
export const events = data.events.map((event) => event.id === 'de'
    ? { ...event, playArea: deCorrection.playArea, zones: deCorrection.zones }
    : event);
export function eventProject(eventId: string) {
    const event = events.find((item) => item.id === eventId);
    if (!event) {
        throw new Error('Unknown event');
    }
    const project = createProject(`Mahlwinkel · ${event.name}`, 'mahlwinkel');
    project.schemaVersion = 2;
    const layers = ['Spielfeld', 'Zonen', 'Grenzlinien', 'Gebäude & Orte', 'Hauptquartiere', 'Safe Zones'].map((name) => ({
        id: crypto.randomUUID(),
        name,
        opacity: 1,
        locked: true,
    }));
    project.workspace = {
        siteId: 'mahlwinkel',
        eventId,
        edition: `fieldmaps-${data.commit.slice(0, 7)}-r2`,
        source: `FieldMaps / @rwolffgang · ${data.commit}. Teilweise von gedruckten Eventkarten abgeleitet; Grenzen können um mehrere zehn Meter abweichen. Dark Emergency: Aussengrenze und fünf Safe Zones nach DE-39517-2026-1 nachgezeichnet (AS-TAC r2). HQ-Punkte sind keine vermessenen HQ-Flächen. Vor Ort geltende Einteilung prüfen.`,
        layers,
    };
    const colour = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#365f4b');
    const add = (sourceId: string, label: string, geometry: Geometry, layer: number, color = '#365f4b', notes = '') => {
        const type: PlanElement['type'] = geometry.type === 'Polygon' ? 'polygon' : geometry.type === 'LineString' ? 'line' : 'point';
        project.elements.push({
            id: crypto.randomUUID(),
            projectId: project.id,
            type,
            geometry,
            label,
            notes,
            sourceId,
            layerId: layers[layer].id,
            phaseIds: [],
            style: { colour: colour(color), width: 2, opacity: 1 },
            version: 1,
        });
    };
    const coordinates = (points: number[][]): Coordinate[] => points.map(([lat, lon]) => [lon, lat]);
    const polygon = (points: number[][]): Geometry => {
        const ring = coordinates(points);
        if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) {
            ring.push([...ring[0]]);
        }
        return { type: 'Polygon', coordinates: [ring] };
    };
    if (event.playArea.length >= 3) {
        add(`mahlwinkel:${event.id}:boundary`, 'Spielfeldgrenze', polygon(event.playArea), 0);
    }
    for (const zone of event.zones) {
        const safe = event.id === 'de' && zone.id.endsWith('-safe');
        if (safe) {
            // Safe areas belong to the site even where the event's play boundary excludes them.
            // Preserve the source footprint; do not invent a larger HQ perimeter from its point.
            add(`mahlwinkel:${event.id}:site:${zone.id}`, '', polygon(zone.points), 0, '#365f4b',
                `${zone.name}: bekannte Gelände-Teilfläche unter der Safe-Zone-Ebene; keine zusätzliche HQ-Grenze.`);
        }
        add(
            `mahlwinkel:${event.id}:zone:${zone.id}`,
            zone.name.replace(/<br\s*\/?\s*>/gi, ' '),
            polygon(zone.points),
            safe ? 5 : 1,
            zone.color,
            safe
                ? 'Nachzeichnung DE-39517-2026-1 · AS-TAC r2; ungefähre Grenze, teils durch Symbole verdeckt. Vor Ort prüfen.'
                : 'Grenze aus FieldMaps; vereinfachte transparente Darstellung.',
        );
    }
    for (const line of event.lines) {
        add(
            `mahlwinkel:${event.id}:line:${line.id}`,
            line.name ?? '',
            { type: 'LineString', coordinates: coordinates(line.points) },
            2,
            line.color,
        );
    }
    for (const point of data.points) {
        const label = (event.poiNames as Record<string, string | undefined>)[point.id];
        if (label) {
            add(`mahlwinkel:poi:${point.id}`, label, { type: 'Point', coordinates: [point.lng, point.lat] }, 3);
        }
    }
    for (const point of event.headquarters) {
        add(`mahlwinkel:${event.id}:hq:${point.id}`, point.name, { type: 'Point', coordinates: [point.lng, point.lat] }, 4, point.color);
    }
    validateProject(project);
    return project;
}
