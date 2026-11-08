import { z } from 'zod';

/** Project document format. Every geometry is WGS84 `[longitude, latitude]`. */
export const FORMAT_VERSION = 1 as const;

const lng = z.number().finite().min(-180).max(180);
const lat = z.number().finite().min(-85.06).max(85.06);
export const LngLatSchema = z.tuple([lng, lat]);
export const ColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
export const AssetRefSchema = z.string().regex(/^[a-f0-9]{64}$/, 'AssetRef must be a lowercase SHA-256 hex digest');
const passiveMime = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/octet-stream']);
const imageMime = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const id = z.string().min(1).max(80);
const shortText = z.string().max(160);
const longText = z.string().max(8000);

export const AttachmentSchema = z.object({
    id,
    asset: AssetRefSchema,
    name: z.string().min(1).max(200),
    mime: passiveMime,
    addedAt: z.string(),
});

export const ObjectiveStatusSchema = z.enum(['unknown', 'enemy', 'contested', 'secured', 'lost']);
export const MarkerTypeSchema = z.enum(['unit', 'enemy', 'objective', 'medic', 'respawn', 'danger', 'hq', 'custom', 'poi', 'flag']);
export const RouteStyleSchema = z.enum(['planned', 'actual', 'alternative', 'boundary']);
export const ZoneCategorySchema = z.enum(['ao', 'nogo', 'respawn', 'objective', 'danger', 'safe', 'civil', 'custom']);
export const ZonePatternSchema = z.enum(['solid', 'hatch', 'cross', 'none']);

const elementBase = {
    id,
    layerId: id.optional(),
    teamId: id.optional(),
    /** Empty or missing means: visible in every briefing phase. */
    phaseIds: z.array(id).max(200).optional(),
    label: shortText.optional(),
    notes: longText.optional(),
    locked: z.boolean().optional(),
    color: ColorSchema.optional(),
    /** Elements bound to an image overlay move with it when the image is re-aligned. */
    anchorImageId: id.optional(),
    /** Stable reference into a source dataset (e.g. a FieldMaps POI id). */
    sourceId: z.string().max(120).optional(),
    attachments: z.array(AttachmentSchema).max(50).optional(),
};

export const MarkerSchema = z.object({
    kind: z.literal('marker'),
    ...elementBase,
    pos: LngLatSchema,
    type: MarkerTypeSchema,
    symbol: z.string().max(60).optional(),
    rotation: z.number().finite().optional(),
    objectiveStatus: ObjectiveStatusSchema.optional(),
});

export const RouteSchema = z.object({
    kind: z.literal('route'),
    ...elementBase,
    points: z.array(LngLatSchema).min(2).max(5000),
    style: RouteStyleSchema,
    arrow: z.boolean(),
    width: z.number().min(1).max(16).optional(),
});

export const ZoneShapeSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('polygon'), points: z.array(LngLatSchema).min(3).max(5000) }),
    z.object({ type: z.literal('circle'), center: LngLatSchema, radiusM: z.number().positive().max(200000) }),
]);

export const ZoneSchema = z.object({
    kind: z.literal('zone'),
    ...elementBase,
    shape: ZoneShapeSchema,
    category: ZoneCategorySchema,
    fillOpacity: z.number().min(0).max(1),
    pattern: ZonePatternSchema.optional(),
    labelPos: LngLatSchema.optional(),
    objectiveStatus: ObjectiveStatusSchema.optional(),
});

export const TextSchema = z.object({
    kind: z.literal('text'),
    ...elementBase,
    pos: LngLatSchema,
    text: z.string().max(400),
    size: z.number().min(8).max(64).optional(),
});

export const BearingSchema = z.object({
    kind: z.literal('bearing'),
    ...elementBase,
    start: LngLatSchema,
    end: LngLatSchema,
});

export const ElementSchema = z.discriminatedUnion('kind', [MarkerSchema, RouteSchema, ZoneSchema, TextSchema, BearingSchema]);

export const StrokeSchema = z.object({
    id,
    points: z.array(LngLatSchema).min(2).max(4000),
    color: ColorSchema,
    width: z.number().min(1).max(24),
    opacity: z.number().min(0.1).max(1),
    layerId: id.optional(),
    briefingOnly: z.boolean().optional(),
    phaseIds: z.array(id).max(200).optional(),
    createdAt: z.string().optional(),
});

export const ControlPointSchema = z.object({
    px: z.tuple([z.number().finite(), z.number().finite()]),
    lngLat: LngLatSchema,
    label: z.string().max(80).optional(),
});

export const ImageOverlaySchema = z.object({
    id,
    name: z.string().min(1).max(160),
    asset: AssetRefSchema,
    mime: imageMime,
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
    /** Top-left, top-right, bottom-right, bottom-left. */
    corners: z.tuple([LngLatSchema, LngLatSchema, LngLatSchema, LngLatSchema]),
    opacity: z.number().min(0).max(1),
    visible: z.boolean(),
    locked: z.boolean().optional(),
    controlPoints: z.array(ControlPointSchema).max(64).optional(),
    fit: z.object({
        method: z.enum(['manual', 'similarity', 'affine', 'known']),
        rmsM: z.number().nonnegative().optional(),
        maxM: z.number().nonnegative().optional(),
    }).optional(),
    knownId: z.string().max(80).optional(),
});

export const LayerSchema = z.object({
    id,
    name: z.string().min(1).max(80),
    visible: z.boolean(),
    opacity: z.number().min(0).max(1),
    locked: z.boolean(),
});

export const TeamPlanningSchema = z.object({
    role: shortText.optional(),
    mission: longText.optional(),
    task: longText.optional(),
    objective: shortText.optional(),
    startPoint: shortText.optional(),
    rallyPoint: shortText.optional(),
    timing: shortText.optional(),
    actionsOnContact: longText.optional(),
    contingency: longText.optional(),
    equipment: longText.optional(),
});

export const TeamSchema = z.object({
    id,
    name: z.string().min(1).max(80),
    callsign: z.string().max(40).optional(),
    unitNumber: z.string().max(12).optional(),
    color: ColorSchema,
    side: z.enum(['friendly', 'enemy', 'neutral']).optional(),
    radioChannel: z.string().max(40).optional(),
    strength: z.number().int().nonnegative().max(9999).optional(),
    leader: z.string().max(80).optional(),
    planning: TeamPlanningSchema.optional(),
    symbol: z.string().max(60).optional(),
    displayMode: z.enum(['icon', 'logo']).optional(),
    logoAsset: AssetRefSchema.optional(),
    formationId: id.optional(),
    formationName: z.string().max(80).optional(),
    squadName: z.string().max(80).optional(),
    inheritFormationVisual: z.boolean().optional(),
    notes: longText.optional(),
});

export const CameraSchema = z.object({
    center: LngLatSchema,
    zoom: z.number().min(0).max(24),
    bearing: z.number().finite(),
});

export const PhaseSchema = z.object({
    id,
    name: z.string().min(1).max(120),
    notes: longText.optional(),
    start: z.string().max(40).optional(),
    end: z.string().max(40).optional(),
    camera: CameraSchema.optional(),
});

export const LogEntrySchema = z.object({
    id,
    t: z.string(),
    text: z.string().min(1).max(2000),
    teamId: id.optional(),
    elementId: id.optional(),
});

export const TrackPointSchema = z.object({
    p: LngLatSchema,
    t: z.string(),
    acc: z.number().nonnegative().optional(),
});

export const TrackSchema = z.object({
    id,
    name: z.string().min(1).max(120),
    startedAt: z.string(),
    endedAt: z.string().optional(),
    points: z.array(TrackPointSchema).max(50000),
});

export const EventRefSchema = z.object({
    siteId: z.string().max(80),
    eventId: z.string().max(80),
    edition: z.string().max(120),
    source: z.string().max(400),
});

export const SettingsSchema = z.object({
    returnToSelect: z.boolean(),
    directManipulation: z.boolean(),
    keepBriefingInk: z.boolean(),
    legLabels: z.boolean(),
    grid: z.enum(['off', '1km', '100m']),
    basemapLabels: z.boolean(),
    unitScale: z.number().min(0.75).max(2.5),
});

/** Collections that are synchronised entity-by-entity in live sessions. */
export const SYNCED_COLLECTIONS = ['elements', 'drawings', 'images', 'teams', 'phases', 'layers', 'log'] as const;
export type SyncedCollection = typeof SYNCED_COLLECTIONS[number];

export const ProjectSchema = z.object({
    id,
    formatVersion: z.literal(FORMAT_VERSION),
    name: z.string().min(1).max(120),
    createdAt: z.string(),
    updatedAt: z.string(),
    areaId: z.string().max(120).nullable(),
    view: CameraSchema.optional(),
    event: EventRefSchema.optional(),
    layers: z.array(LayerSchema).min(1).max(64),
    elements: z.array(ElementSchema).max(20000),
    drawings: z.array(StrokeSchema).max(5000),
    images: z.array(ImageOverlaySchema).max(32),
    teams: z.array(TeamSchema).max(200),
    phases: z.array(PhaseSchema).max(100),
    log: z.array(LogEntrySchema).max(5000),
    tracks: z.array(TrackSchema).max(200),
    settings: SettingsSchema,
}).superRefine((project, ctx) => {
    const layerIds = new Set(project.layers.map((layer) => layer.id));
    for (const collection of SYNCED_COLLECTIONS) {
        const seen = new Set<string>();
        for (const item of project[collection] as { id: string }[]) {
            if (seen.has(item.id)) {
                ctx.addIssue({ code: 'custom', path: [collection], message: `duplicate id ${item.id}` });
            }
            seen.add(item.id);
        }
    }
    for (const element of project.elements) {
        if (element.layerId && !layerIds.has(element.layerId)) {
            ctx.addIssue({ code: 'custom', path: ['elements'], message: `unknown layer ${element.layerId}` });
        }
    }
});

export type LngLat = [number, number];
export type Attachment = z.infer<typeof AttachmentSchema>;
export type ObjectiveStatus = z.infer<typeof ObjectiveStatusSchema>;
export type MarkerType = z.infer<typeof MarkerTypeSchema>;
export type RouteStyle = z.infer<typeof RouteStyleSchema>;
export type ZoneCategory = z.infer<typeof ZoneCategorySchema>;
export type ZonePattern = z.infer<typeof ZonePatternSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export type TextLabel = z.infer<typeof TextSchema>;
export type BearingLine = z.infer<typeof BearingSchema>;
export type Element = z.infer<typeof ElementSchema>;
export type ElementKind = Element['kind'];
export type Stroke = z.infer<typeof StrokeSchema>;
export type ControlPoint = z.infer<typeof ControlPointSchema>;
export type ImageOverlay = z.infer<typeof ImageOverlaySchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type Track = z.infer<typeof TrackSchema>;
export type EventRef = z.infer<typeof EventRefSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Project = z.infer<typeof ProjectSchema>;

