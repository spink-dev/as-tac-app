import { createLayer, createProject, TEAM_COLORS, uid } from '../model/factory';
import { MAX, type ControlPoint, type Element, type ImageOverlay, type LngLat, type MarkerType, type Phase, type Project, type Stroke, type Team, type ZoneCategory } from '../model/schema';
import { cornersFromGeoref, fitControlPoints, georefFromCorners, pixelToLngLat, placeImage, type Corners, type Georef } from '../geo/affine';

/**
 * TacMap 0.12 `.tacmap` → AS-TAC 1.0. TacMap stores everything in image pixels (origin top-left,
 * y down) per map. Each map becomes an image overlay; its elements are converted through the
 * overlay's placement and bound to it (`anchorImageId`), so re-aligning the image moves them along.
 * Treated as untrusted: every field is checked and clamped, unknown values fall back to defaults.
 */

type Raw = Record<string, unknown>;
interface Vec {
    x: number;
    y: number;
}

export interface TacMapAsset {
    hash: string;
    mime: string;
}

export interface TacMapPlacement {
    /** Where uncalibrated maps are dropped; the user aligns them afterwards. */
    center: LngLat;
    /** Ground width the uncalibrated map should roughly cover. */
    widthM: number;
}

export interface TacMapResult {
    project: Project;
    /** Image overlays that only have a rough placement and should be aligned. */
    unaligned: string[];
    skipped: number;
}

const HEX = /^#[0-9a-f]{6}$/i;
const MARKERS = new Set<MarkerType>(['unit', 'enemy', 'objective', 'medic', 'respawn', 'danger', 'hq', 'custom']);
const ZONES = new Set<ZoneCategory>(['ao', 'nogo', 'respawn', 'objective', 'danger', 'custom']);
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const STATUS = new Set(['unknown', 'enemy', 'contested', 'secured', 'lost']);

const obj = (value: unknown): Raw | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : null);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.trim() ? value.slice(0, max) : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const color = (value: unknown): string | undefined => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : undefined);
const hash = (value: unknown): string | undefined => (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : undefined);
const vec = (value: unknown): Vec | null => {
    const v = obj(value);
    const x = num(v?.x);
    const y = num(v?.y);
    return x === undefined || y === undefined ? null : { x, y };
};

/** Place one TacMap map: geo tie points if present, else scale/heading at the placement centre. */
function placeMap(map: Raw, width: number, height: number, placement: TacMapPlacement): { corners: Corners; controlPoints?: ControlPoint[]; fit: ImageOverlay['fit']; aligned: boolean } {
    const calibration = obj(map.calibration);
    if (calibration?.kind === 'geo') {
        const controlPoints: ControlPoint[] = [];
        for (const raw of arr(calibration.points).slice(0, 64)) {
            const p = obj(raw);
            const px = vec(p?.px);
            const lat = num(p?.lat);
            const lon = num(p?.lon);
            if (px && lat !== undefined && lon !== undefined && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) {
                controlPoints.push({ px: [px.x, px.y], lngLat: [lon, lat] });
            }
        }
        if (controlPoints.length >= 2) {
            try {
                const result = fitControlPoints(controlPoints, controlPoints.length >= 4 ? 'affine' : 'similarity');
                const corners = cornersFromGeoref(result.georef, width, height);
                const exact = result.method === 'similarity' && controlPoints.length === 2;
                return {
                    corners,
                    controlPoints,
                    fit: exact ? { method: result.method } : { method: result.method, rmsM: Math.round(result.rmsM * 10) / 10, maxM: Math.round(result.maxM * 10) / 10 },
                    aligned: true,
                };
            } catch {
                // Degenerate tie points: fall through to a rough placement.
            }
        }
    }
    const pxPerMeter = num(calibration?.pxPerMeter);
    const metersPerPixel = pxPerMeter && pxPerMeter > 0 ? 1 / pxPerMeter : placement.widthM / width;
    // TacMap: northRotationDeg is the true heading that map-up points to (clockwise).
    const heading = calibration?.kind === 'heading' ? num(calibration.northRotationDeg) ?? 0 : 0;
    return { corners: placeImage(placement.center, width, height, metersPerPixel, -heading), fit: { method: 'manual' }, aligned: false };
}

function metersPerPixel(georef: Georef): number {
    const { a, b, d, e } = georef.affine;
    return (Math.hypot(a, d) + Math.hypot(b, e)) / 2;
}

export function convertTacMap(raw: unknown, assets: Map<string, TacMapAsset>, placement: TacMapPlacement): TacMapResult {
    const source = obj(raw);
    if (!source || !Array.isArray(source.maps) || source.maps.length === 0) {
        throw new Error('tacmap-invalid');
    }
    const project = createProject({ name: str(source.name, MAX.projectName) ?? 'TacMap', areaId: null });
    project.layers = [];
    const unaligned: string[] = [];
    let skipped = 0;

    // Teams first: elements reference them.
    const teamIds = new Map<string, string>();
    arr(source.teams).slice(0, 200).forEach((value, index) => {
        const team = obj(value);
        const oldId = str(team?.id, 200);
        const name = str(team?.name, MAX.name);
        if (!team || !oldId || !name) {
            skipped += 1;
            return;
        }
        const id = uid('team');
        teamIds.set(oldId, id);
        const planning = obj(team.planning);
        const next: Team = {
            id, name,
            color: color(team.color) ?? TEAM_COLORS[index % TEAM_COLORS.length],
            callsign: str(team.callsign, MAX.callsign),
            unitNumber: str(team.unitNumber, MAX.unitNumber),
            radioChannel: str(team.radioChannel, MAX.radio),
            leader: str(team.leader, MAX.name),
            strength: num(team.strength) !== undefined ? Math.max(0, Math.min(9999, Math.round(num(team.strength)!))) : undefined,
            symbol: str(team.symbol, 60),
            displayMode: team.displayMode === 'logo' ? 'logo' : 'icon',
            formationName: str(team.formationName, MAX.name),
            squadName: str(team.squadName, MAX.name),
            inheritFormationVisual: team.inheritFormationVisual === true ? true : undefined,
            notes: str(team.notes, MAX.longText),
        };
        const logo = hash(team.logoAsset);
        if (logo && assets.has(logo)) {
            next.logoAsset = logo;
        } else {
            next.displayMode = 'icon';
        }
        if (planning) {
            const short = (k: string) => str(planning[k], MAX.shortText);
            const long = (k: string) => str(planning[k], MAX.longText);
            next.planning = {
                role: short('role'), mission: long('mission'), task: long('task'), objective: short('objective'), startPoint: short('startPoint'),
                rallyPoint: short('rallyPoint'), timing: short('timing'), actionsOnContact: long('actionsOnContact'), contingency: long('contingency'), equipment: long('equipment'),
            };
        }
        const formation = str(team.formationId, 200);
        if (formation) {
            next.formationId = `fm_${formation.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'x'}`;
        }
        project.teams.push(JSON.parse(JSON.stringify(next)) as Team);
    });

    const phaseIds = new Map<string, string>();
    for (const value of arr(source.phases).slice(0, 100)) {
        const phase = obj(value);
        const oldId = str(phase?.id, 200);
        const name = str(phase?.name, MAX.phaseName);
        if (!oldId || !name) {
            continue;
        }
        const next: Phase = { id: uid('ph'), name, start: str(phase?.start, 40), end: str(phase?.end, 40) };
        phaseIds.set(oldId, next.id);
        project.phases.push(JSON.parse(JSON.stringify(next)) as Phase);
    }

    const mapGeorefs = new Map<string, Georef>();
    for (const value of arr(source.maps).slice(0, 16)) {
        const map = obj(value);
        const image = hash(map?.image);
        const width = num(map?.width);
        const height = num(map?.height);
        const asset = image ? assets.get(image) : undefined;
        if (!map || !image || !asset || !IMAGE_MIME.has(asset.mime) || !width || !height || width > 16384 || height > 16384) {
            skipped += 1;
            continue;
        }
        const mapName = str(map.name, MAX.imageName) ?? 'Karte';
        const layer = createLayer(mapName.slice(0, MAX.name));
        project.layers.push(layer);
        const placed = placeMap(map, Math.round(width), Math.round(height), placement);
        const overlay: ImageOverlay = {
            id: uid('img'), name: mapName, asset: image, mime: asset.mime as ImageOverlay['mime'], width: Math.round(width), height: Math.round(height),
            corners: placed.corners, opacity: 0.85, visible: true, fit: placed.fit, controlPoints: placed.controlPoints,
        };
        project.images.push(overlay);
        if (!placed.aligned) {
            unaligned.push(overlay.id);
        }
        const georef = georefFromCorners(placed.corners, overlay.width, overlay.height);
        const mpp = metersPerPixel(georef);
        const oldMapId = str(map.id, 200);
        if (oldMapId) {
            mapGeorefs.set(oldMapId, georef);
        }
        const at = (v: unknown): LngLat | null => {
            const p = vec(v);
            return p ? pixelToLngLat(georef, [p.x, p.y]) : null;
        };
        const pts = (v: unknown): LngLat[] => arr(v).map(at).filter((p): p is LngLat => p !== null);

        // Sub-images inside a map keep their pixel rectangle on that map.
        for (const rawOverlay of arr(map.overlays).slice(0, 8)) {
            const o = obj(rawOverlay);
            const oImage = hash(o?.image);
            const oAsset = oImage ? assets.get(oImage) : undefined;
            const rect = obj(o?.bounds);
            const x = num(rect?.x);
            const y = num(rect?.y);
            const w = num(rect?.width);
            const h = num(rect?.height);
            if (!o || !oImage || !oAsset || !IMAGE_MIME.has(oAsset.mime) || x === undefined || y === undefined || !w || !h || project.images.length >= 32) {
                skipped += 1;
                continue;
            }
            const corners: Corners = [pixelToLngLat(georef, [x, y]), pixelToLngLat(georef, [x + w, y]), pixelToLngLat(georef, [x + w, y + h]), pixelToLngLat(georef, [x, y + h])];
            project.images.push({
                id: uid('img'), name: str(o.name, MAX.imageName) ?? mapName, asset: oImage, mime: oAsset.mime as ImageOverlay['mime'],
                width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), corners, opacity: Math.max(0, Math.min(1, num(o.opacity) ?? 1)),
                visible: o.visible !== false, locked: o.locked === true ? true : undefined, fit: { method: 'manual' },
            });
        }

        for (const rawElement of arr(map.elements).slice(0, 20000)) {
            const e = obj(rawElement);
            if (!e) {
                skipped += 1;
                continue;
            }
            const phase = typeof e.phaseId === 'string' ? phaseIds.get(e.phaseId) : undefined;
            const base = {
                id: uid('el'),
                layerId: layer.id,
                anchorImageId: overlay.id,
                label: str(e.label, MAX.shortText),
                notes: str(e.notes, MAX.longText),
                locked: e.locked === true ? true : undefined,
                color: color(e.color),
                phaseIds: phase ? [phase] : undefined,
                teamId: typeof e.teamId === 'string' ? teamIds.get(e.teamId) : undefined,
            };
            let element: Element | null = null;
            switch (e.kind) {
                case 'marker': {
                    const pos = at(e.pos);
                    const symbol = String(e.symbol ?? '');
                    if (pos) {
                        element = {
                            ...base, kind: 'marker', pos, type: MARKERS.has(symbol as MarkerType) ? symbol as MarkerType : 'custom',
                            rotation: num(e.rotation), objectiveStatus: STATUS.has(String(e.objectiveStatus)) ? e.objectiveStatus as never : undefined,
                        };
                    }
                    break;
                }
                case 'route': {
                    const points = pts(e.points).slice(0, 5000);
                    if (points.length >= 2) {
                        const style = e.style === 'actual' || e.style === 'alternative' ? e.style : 'planned';
                        element = { ...base, kind: 'route', points, style, arrow: e.arrow !== false };
                    }
                    break;
                }
                case 'bearing': {
                    const start = at(e.start);
                    const end = at(e.end);
                    if (start && end) {
                        element = { ...base, kind: 'bearing', start, end, teamId: undefined };
                    }
                    break;
                }
                case 'text': {
                    const pos = at(e.pos);
                    const text = str(e.text, MAX.text);
                    if (pos && text) {
                        element = { ...base, kind: 'text', pos, text, size: Math.max(8, Math.min(64, Math.round(num(e.size) ?? 14))), teamId: undefined };
                    }
                    break;
                }
                case 'zone': {
                    const shape = obj(e.shape);
                    const category = ZONES.has(e.category as ZoneCategory) ? e.category as ZoneCategory : 'custom';
                    const fillOpacity = Math.max(0, Math.min(1, num(e.fillOpacity) ?? 0.2));
                    const status = STATUS.has(String(e.objectiveStatus)) ? e.objectiveStatus as never : undefined;
                    if (shape?.type === 'circle') {
                        const center = at(shape.c);
                        const r = num(shape.r);
                        if (center && r && r > 0) {
                            element = { ...base, kind: 'zone', shape: { type: 'circle', center, radiusM: Math.min(MAX.radiusM, r * mpp) }, category, fillOpacity, objectiveStatus: status };
                        }
                    } else if (shape?.type === 'polygon') {
                        const points = pts(shape.points).slice(0, 5000);
                        if (points.length >= 3) {
                            element = { ...base, kind: 'zone', shape: { type: 'polygon', points }, category, fillOpacity, objectiveStatus: status };
                        }
                    }
                    break;
                }
            }
            if (element) {
                project.elements.push(JSON.parse(JSON.stringify(element)) as Element);
            } else {
                skipped += 1;
            }
        }

        for (const rawStroke of arr(map.drawings).slice(0, 5000)) {
            const s = obj(rawStroke);
            const points = pts(s?.points).slice(0, 4000);
            if (!s || points.length < 2) {
                skipped += 1;
                continue;
            }
            const stroke: Stroke = {
                id: uid('ink'), points, color: color(s.color) ?? '#e8402a', width: Math.max(1, Math.min(24, num(s.width) ?? 4)),
                opacity: Math.max(0.1, Math.min(1, num(s.opacity) ?? 0.95)), layerId: layer.id, briefingOnly: s.briefingOnly === true ? true : undefined,
            };
            project.drawings.push(JSON.parse(JSON.stringify(stroke)) as Stroke);
        }
    }
    if (project.images.length === 0) {
        throw new Error('tacmap-no-maps');
    }

    for (const value of arr(source.eventLog).slice(0, 5000)) {
        const entry = obj(value);
        const text = str(entry?.text, MAX.log);
        if (text) {
            project.log.push(JSON.parse(JSON.stringify({ id: uid('log'), t: str(entry?.t, 40) ?? project.createdAt, text, teamId: typeof entry?.teamId === 'string' ? teamIds.get(entry.teamId) : undefined })));
        }
    }

    // Own tracks: GPS points carry lat/lon; otherwise convert the pixel position through their map.
    for (const value of arr(source.tracks).slice(0, 200)) {
        const track = obj(value);
        const georef = typeof track?.mapId === 'string' ? mapGeorefs.get(track.mapId) : undefined;
        const points: Project['tracks'][number]['points'] = [];
        for (const rawPoint of arr(track?.points).slice(0, 50000)) {
            const p = obj(rawPoint);
            const lat = num(p?.lat);
            const lon = num(p?.lon);
            const px = vec(p?.pos);
            const t = str(p?.t, 40) ?? project.createdAt;
            const position: LngLat | null = lat !== undefined && lon !== undefined && Math.abs(lat) <= 85 ? [lon, lat] : georef && px ? pixelToLngLat(georef, [px.x, px.y]) : null;
            if (position) {
                points.push({ p: position, t, acc: num(p?.accuracy) !== undefined ? Math.max(0, num(p?.accuracy)!) : undefined });
            }
        }
        if (track && points.length >= 2) {
            project.tracks.push(JSON.parse(JSON.stringify({ id: uid('trk'), name: str(track.name, MAX.trackName) ?? 'Track', startedAt: str(track.startedAt, 40) ?? project.createdAt, endedAt: str(track.endedAt, 40), points })));
        }
    }

    const settings = obj(source.settings);
    if (settings) {
        project.settings.keepBriefingInk = settings.keepBriefingDrawings === true;
        project.settings.returnToSelect = settings.returnToSelectAfterCreate !== false;
        project.settings.directManipulation = settings.directManipulation !== false;
    }
    if (project.layers.length === 0) {
        project.layers.push(createLayer('Plan'));
    }
    const first = project.images[0];
    const c = first.corners;
    project.view = { center: [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2], zoom: 16, bearing: 0 };
    return { project, unaligned, skipped };
}

/** Whether a JSON document looks like a TacMap project (for format detection). */
export function isTacMapProject(value: unknown): boolean {
    const v = obj(value);
    return Boolean(v && Array.isArray(v.maps) && typeof v.activeMapId === 'string');
}
