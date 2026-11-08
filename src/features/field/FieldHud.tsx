import { useEffect } from 'react';
import { Circle, Compass, Crosshair, Info, LocateFixed, LocateOff, Navigation2, X } from 'lucide-react';
import { t as translate, useT } from '../../i18n';
import { useUi } from '../../core/store/ui';
import { useProject } from '../../core/store/project';
import { usePrefs } from '../../core/store/prefs';
import { ICON, IconButton, Button } from '../../ui/components';
import { isStale, locateOnce, startRecording, stopGps, stopRecording, useGps, installGpsLifecycle } from './gps';
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

/** Map-side rendering of own position, heading, navigation line and own tracks. */
export function useFieldLayers() {
    useEffect(() => {
        let areaBounds: [number, number, number, number] | null = null;
        let warnedOutside = false;
        const render = () => {
            const map = mapRef.current;
            if (!map) {
                return;
            }
            const gps = useGps.getState();
            const compass = useCompass.getState();
            const ui = useUi.getState();
            const project = useProject.getState().project;
            // Own position, tracks and navigation stay off shared screens: Streamer Safe and briefings.
            const hidden = ui.streamer !== 'off' || ui.mode === 'briefing';
            if (hidden || !gps.active || !gps.fix) {
                setSourceData(map, 'gps', EMPTY_FC);
            } else {
                const stale = isStale(gps.fix, gps.now) ? 1 : 0;
                // Compass when available; GPS course only while actually moving.
                const heading = compass.heading ?? ((gps.fix.speed ?? 0) > 0.7 ? gps.fix.heading : null);
                const features: GeoJSON.Feature[] = [
                    { type: 'Feature', properties: { role: 'accuracy', stale }, geometry: { type: 'Polygon', coordinates: [circlePolygon(gps.fix.p, Math.max(3, gps.fix.accuracy), 48)] } },
                    { type: 'Feature', properties: { role: 'dot', stale }, geometry: { type: 'Point', coordinates: gps.fix.p } },
                ];
                if (heading !== null && heading !== undefined) {
                    features.push({ type: 'Feature', properties: { role: 'heading', rot: heading - 90 }, geometry: { type: 'Point', coordinates: gps.fix.p } });
                }
                setSourceData(map, 'gps', { type: 'FeatureCollection', features });
            }
            const target = project?.elements.find((e) => e.id === ui.navTargetId);
            const from = gps.fix?.p;
            setSourceData(map, 'nav', !hidden && ui.mode === 'field' && target && from ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [from, elementAnchor(target)] } }] } : EMPTY_FC);
            const tracks: GeoJSON.Feature[] = [];
            if (!hidden) {
                for (const track of project?.tracks ?? []) {
                    tracks.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: track.points.map((p) => p.p) } });
                }
                if (gps.recording && gps.recording.points.length > 1) {
                    tracks.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: gps.recording.points.map((p) => p.p) } });
                }
            }
            setSourceData(map, 'tracks', { type: 'FeatureCollection', features: tracks });
            if (gps.fix && areaBounds && !warnedOutside) {
                const [w, s, e, n] = areaBounds;
                if (!pointInPolygon(gps.fix.p, [[w, s], [e, s], [e, n], [w, n]])) {
                    warnedOutside = true;
                    useUi.getState().toast(translate('field.outside'), { tone: 'warn' });
                }
            }
            if (compass.headingUp && compass.heading !== null && Math.abs(((map.getBearing() - compass.heading + 540) % 360) - 180) > 0.5) {
                map.setBearing(compass.heading);
            }
        };
        const areaId = useProject.getState().project?.areaId;
        if (areaId) {
            void hasArea(areaId).then((meta) => {
                areaBounds = meta?.bounds ?? null;
            });
        }
        const stopReady = whenMapReady(() => render());
        const unsub = [useGps.subscribe(render), useCompass.subscribe(render), useUi.subscribe((s, p) => {
            if (s.navTargetId !== p.navTargetId || s.streamer !== p.streamer || s.mode !== p.mode) {
                render();
            }
        }), useProject.subscribe((s, p) => {
            if (s.project?.tracks !== p.project?.tracks) {
                render();
            }
        })];
        const stopLifecycle = installGpsLifecycle();
        return () => {
            stopReady();
            unsub.forEach((fn) => fn());
            stopLifecycle();
            stopCompass();
        };
    }, []);
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
                <IconButton label={t('common.close')} onClick={() => stopGps()}><LocateOff {...ICON} /></IconButton>
            ) : null}
            <IconButton label={compassActive ? (headingUp ? t('field.northUp') : t('field.headingUp')) : t('field.compass')} pressed={headingUp} onClick={async () => {
                if (!compassActive) {
                    const ok = await startCompass();
                    if (!ok) {
                        useUi.getState().toast(t('field.compassUnreliable'), { tone: 'warn' });
                    }
                    return;
                }
                const next = !useCompass.getState().headingUp;
                useCompass.setState({ headingUp: next });
                if (!next) {
                    mapRef.current?.easeTo({ bearing: 0, duration: 300 });
                }
            }}>
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
    if (!id || !target) {
        return null;
    }
    const to = elementAnchor(target);
    const origin = from ?? (mapRef.current ? [mapRef.current.getCenter().lng, mapRef.current.getCenter().lat] as LngLat : null);
    if (!origin) {
        return null;
    }
    const bearing = bearingDeg(origin, to);
    const relative = heading === null ? null : bearing - heading;
    return (
        <div className="navcard">
            <span className="navcard__arrow" style={{ transform: `rotate(${relative ?? bearing}deg)` }} aria-hidden>
                <Navigation2 size={28} strokeWidth={2} fill="currentColor" />
            </span>
            <div className="navcard__main">
                <span className="navcard__title">{t('field.navTo', { name: target.label || typeLabel(target) })}</span>
                <span className="navcard__value num">{formatDistance(distanceM(origin, to))} · {unit === 'mil' ? formatMils(bearing) : formatBearing(bearing)}</span>
                {!from ? <span className="navcard__meta">{t('field.noFix')}</span> : null}
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
    const stale = isStale(gps.fix, gps.now);
    const age = gps.fix ? Math.round((gps.now - gps.fix.at) / 1000) : 0;
    return (
        <div className="fieldpanel hud" data-testid="fieldpanel">
            <NavCard from={gps.fix && !stale ? gps.fix.p : null} />
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
                    <Button variant="danger" onClick={() => stopRecording(true)}><Circle size={14} fill="currentColor" /> {t('field.trackStop')} <span className="num">{gps.recording.points.length}</span></Button>
                ) : (
                    <Button onClick={() => startRecording()} disabled={Boolean(readOnly)} title={t('field.trackPrivacy')}><Circle size={14} /> {t('field.track')}</Button>
                )}
            </div>
            <p className="fieldpanel__hint">{t('mode.fieldLocked')} {t('live.gpsNever')}</p>
        </div>
    );
}
