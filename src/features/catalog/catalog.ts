import data from '../../data/mahlwinkel-fieldmaps.json' with { type: 'json' };
import { createProject, validateProject, type Coordinate, type Geometry, type PlanElement } from '../../core/projects/model';
export const events = data.events;
export function eventProject(eventId: string) {
    const event = events.find((item) => item.id === eventId);
    if (!event) {
        throw new Error('Unknown event');
    }
    const project = createProject(`Mahlwinkel · ${event.name}`, 'mahlwinkel');
    project.schemaVersion = 2;
    const layers = ['Spielfeld', 'Zonen', 'Grenzlinien', 'Gebäude & Orte', 'Hauptquartiere'].map((name) => ({
        id: crypto.randomUUID(),
        name,
        opacity: 1,
        locked: true,
    }));
    project.workspace = {
        siteId: 'mahlwinkel',
        eventId,
        edition: `fieldmaps-${data.commit.slice(0, 7)}`,
        source: `FieldMaps / @rwolffgang · ${data.commit}. Teilweise von gedruckten Eventkarten abgeleitet; Grenzen können um mehrere zehn Meter abweichen. Vor Ort geltende Einteilung prüfen.`,
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
        add(
            `mahlwinkel:${event.id}:zone:${zone.id}`,
            zone.name,
            polygon(zone.points),
            1,
            zone.color,
            'Grenze aus FieldMaps; vereinfachte transparente Darstellung.',
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
