import { create } from 'zustand';
import type { LngLat } from '../../core/model/schema';
import { mapRef, whenMapReady } from '../../map/MapView';
import type { MaplibreMap } from '../../map/engine';
import { mutate, useProject } from '../../core/store/project';
import { uid, nowIso } from '../../core/model/factory';
import { toast } from '../../core/store/ui';
import { t } from '../../i18n';
import { distanceM } from '../../core/geo/geo';

/**
 * Own position, device-local only. Nothing here is written to the plan or sent to peers
 * unless the user explicitly saves a recorded path.
 */
export interface Fix {
    p: LngLat;
    accuracy: number;
    heading: number | null;
    speed: number | null;
    at: number;
}

interface GpsState {
    active: boolean;
    follow: boolean;
    fix: Fix | null;
    error: 'denied' | 'unavailable' | 'timeout' | null;
    recording: { startedAt: string; points: { p: LngLat; t: string; acc: number }[] } | null;
    now: number;
}

export const useGps = create<GpsState>(() => ({ active: false, follow: false, fix: null, error: null, recording: null, now: Date.now() }));

let watchId: number | null = null;
let resumeOnVisible = false;
let ticker = 0;

export const STALE_MS = 30000;

export function isStale(fix: Fix | null, now = Date.now()): boolean {
    return !fix || now - fix.at > STALE_MS;
}

function onPosition(position: GeolocationPosition) {
    const fix: Fix = {
        p: [position.coords.longitude, position.coords.latitude],
        accuracy: position.coords.accuracy,
        heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
        at: position.timestamp || Date.now(),
    };
    const state = useGps.getState();
    let recording = state.recording;
    // Only reasonably accurate fixes, thinned by distance, and never beyond the schema cap.
    if (recording && fix.accuracy <= 50 && recording.points.length < 50000) {
        const last = recording.points[recording.points.length - 1];
        if (!last || distanceM(last.p, fix.p) >= Math.max(3, fix.accuracy / 3)) {
            recording = { ...recording, points: [...recording.points, { p: fix.p, t: new Date(fix.at).toISOString(), acc: Math.round(fix.accuracy) }] };
        }
    }
    useGps.setState({ fix, error: null, recording });
    if (state.follow) {
        mapRef.current?.easeTo({ center: fix.p, duration: 400 });
    }
}

function onError(error: GeolocationPositionError) {
    const code = error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'unavailable';
    useGps.setState({ error: code });
    if (code === 'denied') {
        stopGps();
        toast(t('field.denied'), { tone: 'warn' });
    }
}

export function startGps(follow = true) {
    if (!('geolocation' in navigator)) {
        useGps.setState({ error: 'unavailable' });
        return;
    }
    if (watchId === null) {
        watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    }
    window.clearInterval(ticker);
    ticker = window.setInterval(() => useGps.setState({ now: Date.now() }), 5000);
    useGps.setState({ active: true, follow });
}

export function stopGps() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    window.clearInterval(ticker);
    useGps.setState({ active: false, follow: false });
}

/** First press starts GPS and follows; later presses toggle following. GPS stops only explicitly. */
export function locateOnce() {
    const state = useGps.getState();
    if (!state.active) {
        startGps(true);
        if (state.fix) {
            mapRef.current?.easeTo({ center: state.fix.p, zoom: Math.max(mapRef.current.getZoom(), 16), duration: 500 });
        }
        return;
    }
    const follow = !state.follow;
    useGps.setState({ follow });
    if (follow && state.fix) {
        mapRef.current?.easeTo({ center: state.fix.p, duration: 400 });
    }
}

export function startRecording() {
    startGps(useGps.getState().follow);
    useGps.setState({ recording: { startedAt: nowIso(), points: [] } });
}

export function stopRecording(save: boolean): boolean {
    const recording = useGps.getState().recording;
    if (!recording) {
        return false;
    }
    if (!save || recording.points.length < 2) {
        useGps.setState({ recording: null });
        return false;
    }
    const saved = mutate(t('field.track'), (draft) => {
        draft.tracks.push({ id: uid('trk'), name: new Date(recording.startedAt).toLocaleString(), startedAt: recording.startedAt, endedAt: nowIso(), points: recording.points.slice(0, 50000) });
    });
    if (!saved) {
        // Read-only copy or viewer (or the track limit): keep the recording instead of losing it.
        if (useProject.getState().readOnly) {
            toast(t('save.readOnlyCopy'), { tone: 'warn' });
        }
        return false;
    }
    useGps.setState({ recording: null });
    toast(t('field.trackSaved', { n: recording.points.length }), { tone: 'ok' });
    return true;
}

/** Pause GPS while the app is hidden (battery, privacy) and resume only if it was on. */
export function installGpsLifecycle(): () => void {
    const onVisibility = () => {
        if (document.hidden) {
            resumeOnVisible = useGps.getState().active;
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
                watchId = null;
            }
        } else if (resumeOnVisible) {
            resumeOnVisible = false;
            startGps(useGps.getState().follow);
        }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const stopFollow = () => {
        if (useGps.getState().follow) {
            useGps.setState({ follow: false });
        }
    };
    // Panning by hand ends "follow"; attach once the map exists.
    let map: MaplibreMap | null = null;
    const stopReady = whenMapReady((ready) => {
        map = ready;
        ready.on('dragstart', stopFollow);
    });
    return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        stopReady();
        map?.off('dragstart', stopFollow);
        stopGps();
        useGps.setState({ recording: null, fix: null });
    };
}
