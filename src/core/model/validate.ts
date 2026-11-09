import { z } from 'zod';
import {
    ElementSchema, EventRefSchema, ImageOverlaySchema, LayerSchema, LIMITS, LogEntrySchema, MAX, PhaseSchema, SettingsSchema, StrokeSchema, TeamSchema, TrackSchema,
    type Project,
} from './schema';
import { ORDER_ID, type EntityOp } from '../store/diff';

const ENTITY_SCHEMAS = {
    layers: LayerSchema,
    teams: TeamSchema,
    images: ImageOverlaySchema,
    phases: PhaseSchema,
    elements: ElementSchema,
    drawings: StrokeSchema,
    log: LogEntrySchema,
    tracks: TrackSchema,
} as const;

/** Validate one entity of a collection (live sync builds plans entity by entity). */
export function validEntity(collection: keyof typeof ENTITY_SCHEMAS | 'meta', data: unknown): boolean {
    return collection === 'meta' ? MetaSchema.safeParse(data).success : ENTITY_SCHEMAS[collection].safeParse(data).success;
}

const MetaSchema = z.object({
    name: z.string().min(1).max(MAX.projectName),
    areaId: z.string().max(120).nullable(),
    event: EventRefSchema.nullable(),
    settings: SettingsSchema,
});

/**
 * Validate only what a change touched, so a stored plan can never become unloadable
 * (`loadProject` runs the full schema). Cost scales with the change, not the plan.
 * Returns a short reason, or `null` when the change is valid.
 */
export function validateChange(next: Project, ops: EntityOp[]): string | null {
    const touched = new Set<keyof typeof LIMITS>();
    let layersRemoved = false;
    for (const op of ops) {
        if (op.collection === 'meta') {
            const parsed = MetaSchema.safeParse(op.data);
            if (!parsed.success) {
                return `meta: ${parsed.error.issues[0]?.path.join('.')}`;
            }
            continue;
        }
        touched.add(op.collection);
        if (op.entityId === ORDER_ID) {
            continue;
        }
        if (op.data === null) {
            layersRemoved ||= op.collection === 'layers';
            continue;
        }
        const parsed = ENTITY_SCHEMAS[op.collection].safeParse(op.data);
        if (!parsed.success) {
            return `${op.collection}: ${parsed.error.issues[0]?.path.join('.') || 'invalid'}`;
        }
    }
    for (const collection of touched) {
        if (next[collection].length > LIMITS[collection]) {
            return `${collection}: limit ${LIMITS[collection]}`;
        }
    }
    if (next.layers.length === 0) {
        return 'layers: empty';
    }
    if (touched.has('elements') || layersRemoved) {
        const layerIds = new Set(next.layers.map((layer) => layer.id));
        const changed = layersRemoved ? next.elements : ops.filter((op) => op.collection === 'elements' && op.data).map((op) => op.data as Project['elements'][number]);
        if (changed.some((element) => element.layerId && !layerIds.has(element.layerId))) {
            return 'elements: unknown layer';
        }
    }
    return null;
}
