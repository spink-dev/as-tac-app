/** Local plan format. Basemap resources and live GPS never belong in this document. */
export type Coordinate = [number, number];
export type Geometry =
    | { type: 'Point'; coordinates: Coordinate }
    | { type: 'LineString'; coordinates: Coordinate[] }
    | { type: 'Polygon'; coordinates: Coordinate[][] }
    | { type: 'Circle'; center: Coordinate; radiusMeters: number };
export interface PlanElement {
    id: string;
    projectId: string;
    type: 'point' | 'line' | 'polygon' | 'circle' | 'text' | 'freehand';
    geometry: Geometry;
    label: string;
    notes: string;
    layerId?: string;
    sourceId?: string;
    teamId?: string;
    phaseIds: string[];
    style: {
        colour: string;
        width: number;
        opacity: number;
        symbol?: 'auto' | 'none' | 'pin' | 'flag' | 'shield' | 'warning' | 'building' | 'aid';
        pattern?: 'auto' | 'solid' | 'hatch' | 'cross' | 'dots' | 'outline';
        labelMode?: 'auto' | 'always' | 'hidden';
    };
    version: number;
    deletedAt?: string;
}
export interface Team {
    id: string;
    name: string;
    shortLabel: string;
    colour: string;
}
export interface Phase {
    id: string;
    order: number;
    title: string;
    notes: string;
    camera: { center: Coordinate; zoom: number; bearing: number; pitch: number } | null;
    visibleElementIds: string[];
}
export interface PlanLayer {
    id: string;
    name: string;
    opacity: number;
    locked: boolean;
}
export interface Workspace {
    layers: PlanLayer[];
    siteId: string;
    eventId: string;
    edition: string;
    source: string;
}
export interface Project {
    id: string;
    schemaVersion: 1 | 2;
    workspace?: Workspace;
    name: string;
    mapPackageId: string;
    teams: Team[];
    phases: Phase[];
    elements: PlanElement[];
}
export class ProjectError extends Error {
    constructor(public code: 'invalid' | 'version' | 'conflict' | 'missing' | 'storage') {
        super(code);
    }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireValid(condition: unknown): asserts condition {
    if (!condition) {
        throw new ProjectError('invalid');
    }
}
function object(value: unknown): asserts value is Record<string, any> {
    requireValid(value !== null && typeof value === 'object' && !Array.isArray(value));
}
function keys(value: Record<string, unknown>, allowed: string[]) {
    requireValid(Object.keys(value).every((key) => allowed.includes(key)));
}
function text(value: unknown, max: number, nonempty = false): asserts value is string {
    requireValid(typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0));
}
function id(value: unknown): asserts value is string {
    requireValid(typeof value === 'string' && uuid.test(value));
}
function number(value: unknown, min: number, max: number) {
    requireValid(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max);
}
function integer(value: unknown, min = 0) {
    number(value, min, Number.MAX_SAFE_INTEGER);
    requireValid(Number.isInteger(value));
}
function coordinate(value: unknown) {
    requireValid(Array.isArray(value) && value.length === 2);
    number(value[0], -180, 180);
    number(value[1], -90, 90);
}
function colour(value: unknown) {
    requireValid(typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value));
}
function list(value: unknown, max: number): asserts value is any[] {
    requireValid(Array.isArray(value) && value.length <= max);
}
function uniqueIds(items: { id: string }[]) {
    items.forEach((item) => {
        object(item);
        id(item.id);
    });
    requireValid(new Set(items.map((item) => item.id)).size === items.length);
}
function references(values: unknown, available: Set<string>) {
    list(values, 500);
    requireValid(new Set(values).size === values.length && values.every((value) => available.has(value)));
}

/** Reject unknown fields as well as bad values: accidental sensor data is never persisted. */
export function validateProject(value: unknown): asserts value is Project {
    object(value);
    if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
        throw new ProjectError('version');
    }
    keys(value, [
        'id',
        'schemaVersion',
        'name',
        'mapPackageId',
        'teams',
        'phases',
        'elements',
        ...(value.schemaVersion === 2 ? ['workspace'] : []),
    ]);
    const layers: PlanLayer[] = [];
    if (value.workspace !== undefined) {
        object(value.workspace);
        keys(value.workspace, ['layers', 'siteId', 'eventId', 'edition', 'source']);
        list(value.workspace.layers, 32);
        for (const layer of value.workspace.layers) {
            object(layer);
            keys(layer, ['id', 'name', 'opacity', 'locked']);
            id(layer.id);
            text(layer.name, 80, true);
            number(layer.opacity, 0, 1);
            requireValid(typeof layer.locked === 'boolean');
            layers.push(layer as unknown as PlanLayer);
        }
        for (const field of ['siteId', 'eventId', 'edition']) {
            text(value.workspace[field], 120);
        }
        text(value.workspace.source, 2000);
    }
    id(value.id);
    text(value.name, 120, true);
    text(value.mapPackageId, 100, true);
    requireValid(/^[a-z0-9][a-z0-9._-]*$/.test(value.mapPackageId));
    list(value.teams, 100);
    list(value.phases, 100);
    list(value.elements, 500);
    uniqueIds([...layers, ...value.teams, ...value.phases, ...value.elements]);
    const teams = new Set<string>(value.teams.map((team: Team) => team.id));
    const phases = new Set<string>(value.phases.map((phase: Phase) => phase.id));
    const elements = new Set<string>(
        value.elements.filter((element: PlanElement) => !element.deletedAt).map((element: PlanElement) => element.id),
    );
    for (const team of value.teams) {
        keys(team, ['id', 'name', 'shortLabel', 'colour']);
        text(team.name, 120, true);
        text(team.shortLabel, 12, true);
        colour(team.colour);
    }
    requireValid(new Set(value.phases.map((phase: Phase) => phase.order)).size === value.phases.length);
    for (const phase of value.phases) {
        keys(phase, ['id', 'order', 'title', 'notes', 'camera', 'visibleElementIds']);
        integer(phase.order);
        text(phase.title, 120, true);
        text(phase.notes, 10_000);
        references(phase.visibleElementIds, elements);
        if (phase.camera !== null) {
            object(phase.camera);
            keys(phase.camera, ['center', 'zoom', 'bearing', 'pitch']);
            coordinate(phase.camera.center);
            number(phase.camera.zoom, 0, 24);
            number(phase.camera.bearing, -360, 360);
            number(phase.camera.pitch, 0, 85);
        }
    }
    let vertices = 0;
    for (const element of value.elements) {
        keys(element, [
            'id',
            'projectId',
            'type',
            'geometry',
            'label',
            'notes',
            'teamId',
            'phaseIds',
            'style',
            'version',
            'deletedAt',
            ...(value.schemaVersion === 2 ? ['layerId', 'sourceId'] : []),
        ]);
        requireValid(element.layerId === undefined || layers.some((layer) => layer.id === element.layerId));
        if (element.sourceId !== undefined) {
            text(element.sourceId, 200, true);
        }
        requireValid(element.projectId === value.id);
        text(element.label, 200);
        text(element.notes, 10_000);
        integer(element.version, 1);
        if (element.deletedAt !== undefined) {
            requireValid(typeof element.deletedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(element.deletedAt));
            requireValid(Number.isFinite(Date.parse(element.deletedAt)) && new Date(element.deletedAt).toISOString() === element.deletedAt);
        }
        requireValid(element.teamId === undefined || teams.has(element.teamId));
        references(element.phaseIds, phases);
        object(element.style);
        keys(element.style, ['colour', 'width', 'opacity', 'symbol', 'pattern', 'labelMode']);
        for (const [key, allowed] of Object.entries({
            symbol: ['auto', 'none', 'pin', 'flag', 'shield', 'warning', 'building', 'aid'],
            pattern: ['auto', 'solid', 'hatch', 'cross', 'dots', 'outline'],
            labelMode: ['auto', 'always', 'hidden'],
        })) {
            if (element.style[key] !== undefined) {
                requireValid(allowed.includes(element.style[key]));
            }
        }
        colour(element.style.colour);
        number(element.style.width, 1, 20);
        number(element.style.opacity, 0, 1);
        const geometry = element.geometry;
        object(geometry);
        const expected = {
            point: 'Point',
            text: 'Point',
            line: 'LineString',
            freehand: 'LineString',
            polygon: 'Polygon',
            circle: 'Circle',
        };
        requireValid(Object.hasOwn(expected, element.type) && geometry.type === expected[element.type as keyof typeof expected]);
        if (geometry.type === 'Circle') {
            keys(geometry, ['type', 'center', 'radiusMeters']);
            coordinate(geometry.center);
            number(geometry.radiusMeters, 0.1, 100_000);
            vertices += 1;
        } else {
            keys(geometry, ['type', 'coordinates']);
            if (geometry.type === 'Point') {
                coordinate(geometry.coordinates);
                vertices += 1;
            } else {
                const lines = geometry.type === 'Polygon' ? geometry.coordinates : [geometry.coordinates];
                list(lines, 100);
                requireValid(lines.length > 0);
                for (const line of lines) {
                    list(line, 5_000);
                    requireValid(line.length >= (geometry.type === 'Polygon' ? 4 : 2));
                    line.forEach(coordinate);
                    vertices += line.length;
                    if (geometry.type === 'Polygon') {
                        requireValid(line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1]);
                        requireValid(new Set(line.map((point) => JSON.stringify(point))).size >= 3);
                    }
                }
            }
        }
        requireValid(vertices <= 100_000);
    }
}

export function createProject(name: string, mapPackageId: string): Project {
    const project: Project = { id: crypto.randomUUID(), schemaVersion: 1, name, mapPackageId, teams: [], phases: [], elements: [] };
    validateProject(project);
    return project;
}

export function duplicateProject(source: Project, name: string): Project {
    validateProject(source);
    const copy = structuredClone(source);
    const ids = new Map(
        [
            source.id,
            ...source.teams.map((team) => team.id),
            ...source.phases.map((phase) => phase.id),
            ...source.elements.map((element) => element.id),
            ...(source.workspace?.layers.map((layer) => layer.id) ?? []),
        ].map((old) => [old, crypto.randomUUID()]),
    );
    copy.id = ids.get(source.id)!;
    copy.name = name;
    for (const layer of copy.workspace?.layers ?? []) {
        layer.id = ids.get(layer.id)!;
    }
    for (const team of copy.teams) {
        team.id = ids.get(team.id)!;
    }
    for (const phase of copy.phases) {
        phase.id = ids.get(phase.id)!;
        phase.visibleElementIds = phase.visibleElementIds.map((old) => ids.get(old)!);
    }
    for (const element of copy.elements) {
        element.id = ids.get(element.id)!;
        element.projectId = copy.id;
        if (element.layerId) {
            element.layerId = ids.get(element.layerId)!;
        }
        element.version = 1;
        element.teamId = element.teamId ? ids.get(element.teamId)! : undefined;
        element.phaseIds = element.phaseIds.map((old) => ids.get(old)!);
    }
    validateProject(copy);
    return copy;
}

export function workspaceOf(project: Project): Workspace {
    return project.workspace ?? { layers: [], siteId: '', eventId: '', edition: '', source: '' };
}
