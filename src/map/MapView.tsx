import { useEffect, useRef } from 'react';
import type { MapMouseEvent, Map as MlMap } from 'maplibre-gl';
import { MaplibreMap } from './engine';
import { useProject } from '../core/store/project';
import { useUi } from '../core/store/ui';
import { usePrefs } from '../core/store/prefs';
import { getArea, ensureArea } from '../core/areas/store';
import { kvGet, kvSet } from '../core/storage/db';
import { utmGrid } from '../core/geo/mgrs';
import type { Camera, Project } from '../core/model/schema';
import { t } from '../i18n';
import { toast } from '../core/store/ui';
import { applyBasemapPalette, baseStyle, EMPTY_FC, setBasemapLabels } from './basemap';
import { installIconFactory } from './icons';
import { PALETTES } from './palette';
import { addPlanLayers, applyPlanPalette, setPlanData, setSourceData } from './planLayers';
import { buildPlanCollections } from './planFeatures';
import { syncImageOverlays } from './images';
import { installInteraction } from './interaction';
import { installAlign } from './align';
import { renderDraft, renderEdit } from './overlays';

export const mapRef: { current: MlMap | null } = { current: null };
/** True once plan sources and layers exist. `isStyleLoaded()` is false while big sources parse. */
let planReady = false;

let viewSaveGuard: (() => boolean) | null = null;

/** Lets a feature veto remembering the camera (e.g. while it follows the own GPS position). */
export function setViewSaveGuard(guard: (() => boolean) | null) {
    viewSaveGuard = guard;
}

export function isPlanReady(): boolean {
    return planReady && mapRef.current !== null;
}
const readyCallbacks = new Set<(map: MlMap) => void>();

/** Run `fn` once the workspace map is loaded (immediately if it already is). */
export function whenMapReady(fn: (map: MlMap) => void): () => void {
    const map = mapRef.current;
    if (map && planReady) {
        fn(map);
        return () => undefined;
    }
    readyCallbacks.add(fn);
    return () => {
        readyCallbacks.delete(fn);
    };
}

export function glyphUrl(): string {
    return `${window.location.origin}/glyphs/{fontstack}/{range}.pbf`;
}

export function currentCamera(map: MlMap): Camera {
    const c = map.getCenter();
    return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() };
}

export function flyTo(camera: Partial<Camera> & { center: [number, number] }, instant = false) {
    const map = mapRef.current;
    if (!map) {
        return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.easeTo({ center: camera.center, zoom: camera.zoom ?? map.getZoom(), bearing: camera.bearing ?? map.getBearing(), duration: instant || reduce ? 0 : 650, easing: (x) => 1 - Math.pow(1 - x, 4) });
}

let scheduled = 0;
function schedulePlanRender() {
    if (scheduled) {
        return;
    }
    scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        renderPlan();
    });
}

export function renderPlan() {
    const map = mapRef.current;
    const project = useProject.getState().project;
    if (!map || !planReady || !project) {
        return;
    }
    const ui = useUi.getState();
    const prefs = usePrefs.getState();
    const phase = ui.mode === 'briefing' && project.phases.length > 0 ? project.phases[Math.min(ui.phaseIndex, project.phases.length - 1)] : null;
    const override = ui.override;
    const view = override ? { ...project, elements: project.elements.map((e) => (e.id === override.id ? override : e)) } : project;
    const collections = buildPlanCollections(view, {
        mode: ui.mode,
        phaseId: phase?.id ?? null,
        streamer: ui.streamer,
        selection: new Set(ui.selection),
        bearingUnit: prefs.bearingUnit,
        briefingInk: ui.briefingInk,
        streamerInk: ui.streamerInk,
    }, project.settings.unitScale, project.settings.legLabels);
    setPlanData(map, collections);
    renderEdit(map);
    void syncImageOverlays(map, project.images, ui.streamer === 'public');
    setBasemapLabels(map, project.settings.basemapLabels);
}

export function renderGrid() {
    const map = mapRef.current;
    const project = useProject.getState().project;
    if (!map || !planReady) {
        return;
    }
    const grid = project?.settings.grid ?? 'off';
    if (grid === 'off' || useUi.getState().streamer !== 'off' || map.getZoom() < (grid === '100m' ? 14 : 11)) {
        setSourceData(map, 'grid', EMPTY_FC);
        return;
    }
    const b = map.getBounds();
    const lines = utmGrid([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], grid === '100m' ? 100 : 1000);
    setSourceData(map, 'grid', {
        type: 'FeatureCollection',
        features: lines.map((line) => ({ type: 'Feature', properties: { label: line.label, major: line.major ? 1 : 0 }, geometry: { type: 'LineString', coordinates: line.coordinates } })),
    });
}

let loadedAreaId: string | null | undefined;

async function loadArea(project: Project, fit: boolean) {
    const map = mapRef.current;
    if (!map) {
        return;
    }
    if (project.areaId === loadedAreaId) {
        return;
    }
    loadedAreaId = project.areaId;
    if (!project.areaId) {
        setSourceData(map, 'osm', EMPTY_FC);
        return;
    }
    let row = await getArea(project.areaId);
    if (!row) {
        try {
            toast(t('new.installing'));
            await ensureArea(project.areaId);
            row = await getArea(project.areaId);
        } catch {
            toast(t('area.needsNetwork'), { tone: 'warn' });
        }
    }
    if (!row || mapRef.current !== map || useProject.getState().project?.areaId !== project.areaId) {
        return;
    }
    setSourceData(map, 'osm', row.data);
    if (fit) {
        const [w, s, e, n] = row.meta.bounds;
        map.fitBounds([[w, s], [e, n]], { padding: 40, duration: 0 });
    }
}

function updateRedFilter(container: HTMLElement) {
    const { appearance, redMapFilter } = usePrefs.getState();
    container.classList.toggle('map--red', appearance === 'red' && redMapFilter);
}

export function MapView() {
    const container = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = container.current;
        if (!element) {
            return;
        }
        const project = useProject.getState().project;
        const palette = PALETTES[usePrefs.getState().appearance];
        const map = new MaplibreMap({
            container: element,
            style: baseStyle(palette, glyphUrl()),
            center: project?.view?.center ?? [11.823, 52.381],
            zoom: project?.view?.zoom ?? 14,
            bearing: project?.view?.bearing ?? 0,
            maxPitch: 0,
            pitchWithRotate: false,
            touchPitch: false,
            attributionControl: false,
            fadeDuration: 0,
            dragRotate: true,
            maxZoom: 21,
            clickTolerance: 4,
            cancelPendingTileRequestsWhileZooming: true,
        });
        map.touchZoomRotate.enableRotation();
        map.keyboard.disable();
        mapRef.current = map;
        planReady = false;
        loadedAreaId = undefined;
        installIconFactory(map);
        updateRedFilter(element);

        let disposed = false;
        let stopInteraction: (() => void) | null = null;
        map.on('load', async () => {
            if (disposed || mapRef.current !== map) {
                return;
            }
            addPlanLayers(map, palette);
            planReady = true;
            const stopTools = installInteraction(map);
            const stopAlign = installAlign(map);
            stopInteraction = () => {
                stopTools();
                stopAlign();
            };
            renderPlan();
            for (const fn of readyCallbacks) {
                fn(map);
            }
            readyCallbacks.clear();
            const current = useProject.getState().project;
            if (current) {
                const saved = await kvGet<Camera | null>(`view:${current.id}`, null);
                if (disposed) {
                    return;
                }
                if (saved) {
                    map.jumpTo({ center: saved.center, zoom: saved.zoom, bearing: saved.bearing });
                }
                await loadArea(current, !saved && !current.view);
            }
            if (disposed || mapRef.current !== map) {
                return;
            }
            renderPlan();
            renderGrid();
        });

        let saveTimer = 0;
        map.on('moveend', () => {
            renderGrid();
            const current = useProject.getState().project;
            window.clearTimeout(saveTimer);
            if (current && (viewSaveGuard?.() ?? true)) {
                saveTimer = window.setTimeout(() => void kvSet(`view:${current.id}`, currentCamera(map)), 400);
            }
        });
        map.on('mousemove', (event: MapMouseEvent) => {
            useUi.setState({ cursor: [event.lngLat.lng, event.lngLat.lat] });
        });

        const unsubProject = useProject.subscribe((state, prev) => {
            if (state.project !== prev.project) {
                schedulePlanRender();
                if (state.project && state.project.areaId !== prev.project?.areaId) {
                    void loadArea(state.project, false);
                }
                if (state.project?.settings.grid !== prev.project?.settings.grid) {
                    renderGrid();
                }
            }
        });
        const unsubUi = useUi.subscribe((state, prev) => {
            if (state.selection !== prev.selection || state.mode !== prev.mode || state.phaseIndex !== prev.phaseIndex || state.streamer !== prev.streamer
                || state.briefingInk !== prev.briefingInk || state.streamerInk !== prev.streamerInk || state.override !== prev.override) {
                schedulePlanRender();
            }
            if ((state.draft !== prev.draft || state.measure !== prev.measure || state.zoneShape !== prev.zoneShape) && planReady) {
                renderDraft(map);
            }
            if ((state.tool !== prev.tool || state.imageEditId !== prev.imageEditId) && planReady) {
                renderEdit(map);
            }
            if (state.streamer !== prev.streamer && planReady) {
                renderGrid();
                renderDraft(map);
                renderEdit(map);
            }
        });
        const unsubPrefs = usePrefs.subscribe((state, prev) => {
            if (state.appearance !== prev.appearance) {
                const next = PALETTES[state.appearance];
                applyBasemapPalette(map, next);
                applyPlanPalette(map, next);
            }
            if (state.appearance !== prev.appearance || state.redMapFilter !== prev.redMapFilter) {
                updateRedFilter(element);
            }
            if (state.bearingUnit !== prev.bearingUnit) {
                schedulePlanRender();
            }
        });

        const resize = new ResizeObserver(() => map.resize());
        resize.observe(element);

        return () => {
            disposed = true;
            stopInteraction?.();
            unsubProject();
            unsubUi();
            unsubPrefs();
            resize.disconnect();
            window.clearTimeout(saveTimer);
            map.remove();
            if (mapRef.current === map) {
                mapRef.current = null;
                planReady = false;
            }
        };
    }, []);

    return <div ref={container} className="map" data-testid="map" />;
}

// Test hook for the browser suites: the current camera only.
if (typeof window !== 'undefined') {
    (window as unknown as { __asTacCamera: () => { center: [number, number]; bearing: number } | null }).__asTacCamera = () => {
        const map = mapRef.current;
        return map ? { center: [map.getCenter().lng, map.getCenter().lat], bearing: map.getBearing() } : null;
    };
}
