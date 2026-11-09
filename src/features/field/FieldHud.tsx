import { useEffect, useRef, useState } from 'react';
import { Circle, Compass, Crosshair, Info, LocateFixed, LocateOff, Navigation2, X } from 'lucide-react';
import { t as translate, useT } from '../../i18n';
import { toast, useUi } from '../../core/store/ui';
import { useProject } from '../../core/store/project';
import { usePrefs } from '../../core/store/prefs';
import { ICON, IconButton, Button } from '../../ui/components';
import { isStale, liveFix, locateOnce, positionHidden, startRecording, stopGps, stopRecording, useGps, installGpsLifecycle } from './gps';
import { startCompass, stopCompass, useCompass } from './compass';
import { mapRef, whenMapReady } from '../../map/MapView';
import { setSourceData } from '../../map/planLayers';
import { EMPTY_FC } from '../../map/basemap';
import { bearingDeg, circlePolygon, distanceM, formatBearing, formatDistance, formatMils, pointInPolygon } from '../../core/geo/geo';
import { toMgrs } from '../../core/geo/mgrs';
import { elementAnchor } from '../../map/planFeatures';
import { typeLabel } from '../../core/actions';
import type { LngLat } from '../../core/model/schema';
import { hasArea } from '../../core/areas/store';

/**
 * Map-side rendering of own position, heading, navigation line and own tracks. Split by cost:
 * compass readings only touch the heading arrow and bearing; saved tracks are rebuilt only
 * when they change, not on every GPS fix.
 */
export function useFieldLayers() {
    useEffect(() => {
        let areaBounds: [number, number, number, number] | null = null;
        let warnedOutside = false;
        let savedTracks: GeoJSON.Feature[] = [];
        let savedFor: unknown = null;
        let lastBearingAt = 0;
        const hiddenNow = () => positionHidden();

        const renderPosition = () => {
            const map = mapRef.current;
            if (!map) {
                return;
            }
            const gps = useGps.getState();
            const ui = useUi.getState();
            const fix = gps.active ? gps.fix : null;
            if (hiddenNow() || !fix) {
                setSourceData(map, 'gps', EMPTY_FC);
            } else {
                const stale = isStale(fix, Math.max(gps.now, Date.now())) ? 1 : 0;
                const features: GeoJSON.Feature[] = [
                    { type: 'Feature', properties: { role: 'accuracy', stale }, geometry: { type: 'Polygon', coordinates: [circlePolygon(fix.p, Math.max(3, fix.accuracy), 48)] } },
                    { type: 'Feature', properties: { role: 'dot', stale }, geometry: { type: 'Point', coordinates: fix.p } },
                ];
                const heading = currentHeading();
                if (heading !== null) {
                    features.push({ type: 'Feature', properties: { role: 'heading', rot: heading - 90 }, geometry: { type: 'Point', coordinates: fix.p } });
                }
                setSourceData(map, 'gps', { type: 'FeatureCollection', features });
            }
            const project = useProject.getState().project;
            const target = ui.navTargetId ? project?.elements.find((e) => e.id === ui.navTargetId) : undefined;
            const from = liveFix(gps)?.p;
            setSourceData(map, 'nav', !hiddenNow() && ui.mode === 'field' && target && from ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [from, elementAnchor(target)] } }] } : EMPTY_FC);
            if (fix && areaBounds && !warnedOutside && !hiddenNow()) {
                const [w, s, e, n] = areaBounds;
                if (!pointInPolygon(fix.p, [[w, s], [e, s], [e, n], [w, n]])) {
                    warnedOutside = true;
                    useUi.getState().toast(translate('field.outside'), { tone: 'warn' });
                }
            }
        };

        const renderTracks = () => {
            const map = mapRef.current;
            if (!map) {
                return;
            }
            const project = useProject.getState().project;
            const recording = useGps.getState().recording;
            if (hiddenNow()) {
                setSourceData(map, 'tracks', EMPTY_FC);
                return;
            }
            if (savedFor !== project?.tracks) {
                savedFor = project?.tracks;
                savedTracks = (project?.tracks ?? []).map((track) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track.points.map((p) => p.p) } }));
            }
            const features = recording && recording.points.length > 1
                ? [...savedTracks, { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: recording.points.map((p) => p.p) } } as GeoJSON.Feature]
                : savedTracks;
            setSourceData(map, 'tracks', { type: 'FeatureCollection', features });
        };

        /** Compass update: heading arrow, and the map bearing in heading-up (throttled, never mid-move). */
        const renderHeading = () => {
            const map = mapRef.current;
            const compass = useCompass.getState();
            if (!map) {
                return;
            }
            renderPosition();
            // While following, the follow move carries the bearing; between fixes we still turn (not mid-move).
            if (!compass.headingUp || compass.heading === null || hiddenNow() || map.isMoving()) {
                return;
            }
            const now = performance.now();
            const delta = Math.abs(((map.getBearing() - compass.heading + 540) % 360) - 180);
            if (delta > 2 && now - lastBearingAt > 120) {
                lastBearingAt = now;
                map.easeTo({ bearing: compass.heading, duration: 100 });
            }
        };

        const loadBounds = (areaId: string | null | undefined) => {
            areaBounds = null;
            warnedOutside = false;
            if (areaId) {
                void hasArea(areaId).then((meta) => {
                    areaBounds = meta?.bounds ?? null;
                });
            }
        };
        loadBounds(useProject.getState().project?.areaId);
        const renderAll = () => {
            renderPosition();
            renderTracks();
        };
        const stopReady = whenMapReady(() => renderAll());
        const unsub = [
            useGps.subscribe((state, prev) => {
                renderPosition();
                if (state.recording !== prev.recording) {
                    renderTracks();
                }
            }),
            useCompass.subscribe((state, prev) => {
                if (state.heading !== prev.heading || state.headingUp !== prev.headingUp) {
                    renderHeading();
                }
            }),
            useUi.subscribe((state, prev) => {
                if (state.navTargetId !== prev.navTargetId || state.streamer !== prev.streamer || state.mode !== prev.mode) {
                    renderAll();
                }
            }),
            useProject.subscribe((state, prev) => {
                if (state.project?.tracks !== prev.project?.tracks) {
                    renderTracks();
                }
                if (state.project?.areaId !== prev.project?.areaId) {
                    loadBounds(state.project?.areaId);
                }
            }),
            // Areas installed while the plan is open (e.g. downloaded later) count too.
            useGps.subscribe((state, prev) => {
                if (state.active && !prev.active && !areaBounds) {
                    loadBounds(useProject.getState().project?.areaId);
                }
            }),
        ];
        const stopLifecycle = installGpsLifecycle();
        return () => {
            stopReady();
            unsub.forEach((fn) => fn());
            stopLifecycle();
            stopCompass();
        };
    }, []);
}

/** Compass when it gives a north-referenced heading; GPS course only while actually moving. */
function currentHeading(): number | null {
    const compass = useCompass.getState().heading;
    if (compass !== null) {
        return compass;
    }
    const fix = liveFix();
    return fix && (fix.speed ?? 0) > 0.7 && fix.heading !== null ? fix.heading : null;
}

/** Normalise an angle to −180…180 so rotations take the short way round. */
function signed(angle: number): number {
    return ((angle % 360) + 540) % 360 - 180;
}

/** Right-hand HUD buttons: locate/follow and compass. */
export function FieldHudButtons() {
    const t = useT();
    const active = useGps((state) => state.active);
    const follow = useGps((state) => state.follow);
    const fix = useGps((state) => state.fix);
    const now = useGps((state) => state.now);
    const compassActive = useCompass((state) => state.active);
    const headingUp = useCompass((state) => state.headingUp);
    const recording = useGps((state) => Boolean(state.recording));
    const streamer = useUi((state) => state.streamer);
    const mode = useUi((state) => state.mode);
    if (streamer !== 'off' || mode === 'briefing') {
        return null;
    }
    const stale = active && isStale(fix, now);
    return (
        <div className="hud hud--stack">
            {recording && mode !== 'field' ? (
                // A running path recording stays reachable outside field mode.
                <IconButton label={t('field.trackStop')} className="is-recording" onClick={() => stopRecording(true)}><Circle size={18} fill="currentColor" /></IconButton>
            ) : null}
            <IconButton label={active ? t('field.follow') : t('field.locate')} pressed={active && follow} onClick={() => locateOnce()} data-testid="locate" className={stale ? 'is-stale' : ''}>
                {active ? <LocateFixed {...ICON} /> : <Crosshair {...ICON} />}
            </IconButton>
            {active ? (
                <IconButton label={recording ? t('field.gpsOffRecording') : t('field.gpsOff')} disabled={recording} onClick={() => stopGps()} data-testid="gps-off"><LocateOff {...ICON} /></IconButton>
            ) : null}
            <IconButton
                label={!compassActive ? t('field.compassOn') : headingUp ? t('field.compassOff') : t('field.headingUp')}
                pressed={compassActive}
                className={headingUp ? 'is-heading-up' : ''}
                onClick={async () => {
                    // Cycle: off → compass (heading arrow) → heading-up → off.
                    if (!compassActive) {
                        const ok = await startCompass(() => toast(t('field.compassDenied'), { tone: 'warn' }));
                        if (!ok) {
                            toast(t('field.compassDenied'), { tone: 'warn' });
                        }
                        return;
                    }
                    if (!useCompass.getState().headingUp) {
                        useCompass.setState({ headingUp: true });
                        return;
                    }
                    stopCompass();
                    mapRef.current?.easeTo({ bearing: 0, duration: 300 });
                }}
            >
                <Compass {...ICON} />
            </IconButton>
        </div>
    );
}

function NavCard({ from }: { from: LngLat | null }) {
    const t = useT();
    const id = useUi((state) => state.navTargetId);
    const target = useProject((state) => state.project?.elements.find((e) => e.id === id));
    const heading = useCompass((state) => state.heading);
    const unit = usePrefs((state) => state.bearingUnit);
    const gpsOn = useGps((state) => state.active);
    const angle = useRef(0);
    // Without a live fix the card measures from the map centre; follow map moves then.
    const [view, setView] = useState<{ center: LngLat; bearing: number } | null>(null);
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !id) {
            return;
        }
        const update = () => setView({ center: [map.getCenter().lng, map.getCenter().lat], bearing: map.getBearing() });
        update();
        map.on('move', update);
        return () => {
            map.off('move', update);
        };
    }, [id]);
    if (!id || !target) {
        return null;
    }
    const to = elementAnchor(target);
    const origin = from ?? view?.center ?? null;
    if (!origin) {
        return null;
    }
    const bearing = bearingDeg(origin, to);
    // Arrow relative to where the phone points (compass) or to screen-up (map bearing).
    const reference = heading ?? view?.bearing ?? 0;
    // Continuous angle: always turn the short way, also across 180° (no full spin in the transition).
    const wanted = signed(bearing - reference);
    const previous = angle.current;
    angle.current = previous + signed(wanted - previous);
    return (
        <div className="navcard">
            <span className="navcard__arrow" style={{ transform: `rotate(${angle.current}deg)` }} aria-hidden>
                <Navigation2 size={28} strokeWidth={2} fill="currentColor" />
            </span>
            <div className="navcard__main">
                <span className="navcard__title">{t('field.navTo', { name: target.label || typeLabel(target) })}</span>
                <span className="navcard__value num">{formatDistance(distanceM(origin, to))} · {unit === 'mil' ? formatMils(bearing) : formatBearing(bearing)}</span>
                {!from ? <span className="navcard__meta">{gpsOn ? t('field.noFix') : t('field.mapCenter')}</span> : null}
            </div>
            <IconButton label={t('field.navStop')} onClick={() => useUi.getState().set({ navTargetId: null })}><X {...ICON} /></IconButton>
        </div>
    );
}

/** Tapping an object in the field offers navigation to it right in the field panel. */
function SelectedTarget() {
    const t = useT();
    const selection = useUi((state) => state.selection);
    const navTargetId = useUi((state) => state.navTargetId);
    const element = useProject((state) => (selection.length === 1 ? state.project?.elements.find((e) => e.id === selection[0]) : undefined));
    if (!element || element.id === navTargetId) {
        return null;
    }
    return (
        <div className="fieldpanel__row fieldpanel__target">
            <span className="fieldpanel__targetname">{element.label || typeLabel(element)}</span>
            <IconButton label={t('panel.inspector')} onClick={() => useUi.getState().openPanel('inspector')}><Info {...ICON} /></IconButton>
            <Button variant="primary" onClick={() => useUi.getState().set({ navTargetId: element.id })} data-testid="field-navigate">
                <Navigation2 size={16} /> {t('inspector.navigate')}
            </Button>
        </div>
    );
}

/** Bottom field panel: big readable own position, navigation and path recording. */
export function FieldPanel() {
    const t = useT();
    const mode = useUi((state) => state.mode);
    const streamer = useUi((state) => state.streamer);
    const gps = useGps();
    const format = usePrefs((state) => state.coordFormat);
    const readOnly = useProject((state) => state.readOnly);
    if (mode !== 'field' || streamer !== 'off') {
        return null;
    }
    const stale = isStale(gps.fix, Math.max(gps.now, Date.now()));
    const age = gps.fix ? Math.round((Math.max(gps.now, Date.now()) - gps.fix.at) / 1000) : 0;
    return (
        <div className="fieldpanel hud" data-testid="fieldpanel">
            <NavCard from={liveFix(gps)?.p ?? null} />
            <SelectedTarget />
            <div className="fieldpanel__row">
                {gps.active && gps.fix ? (
                    <div className="fieldpanel__pos">
                        <span className="fieldpanel__coord data">{format === 'mgrs' ? toMgrs(gps.fix.p, 5) : `${gps.fix.p[1].toFixed(5)}, ${gps.fix.p[0].toFixed(5)}`}</span>
                        <span className={`fieldpanel__meta num ${stale ? 'is-stale' : ''}`}>
                            {t('field.accuracy', { m: Math.round(gps.fix.accuracy) })}{stale ? ` · ${t('field.stale', { s: age })}` : ''}
                        </span>
                    </div>
                ) : (
                    <button type="button" className="fieldpanel__locate" onClick={() => locateOnce()}>
                        <Crosshair size={22} /> {gps.active ? (gps.error === 'unavailable' ? t('field.unavailable') : t('field.noFix')) : t('field.locate')}
                    </button>
                )}
                {gps.recording ? (
                    <>
                        <Button variant="danger" onClick={() => stopRecording(true)}><Circle size={14} fill="currentColor" /> {t('field.trackStop')} <span className="num">{gps.recording.points.length}</span></Button>
                        {gps.saveFailed ? <Button variant="ghost" onClick={() => stopRecording(false)}>{t('field.trackDiscard')}</Button> : null}
                    </>
                ) : (
                    <Button onClick={() => startRecording()} disabled={Boolean(readOnly)} title={t('field.trackPrivacy')}><Circle size={14} /> {t('field.track')}</Button>
                )}
            </div>
            <p className="fieldpanel__hint">{t('mode.fieldLocked')} {t('live.gpsNever')}</p>
        </div>
    );
}
