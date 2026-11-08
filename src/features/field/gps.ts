import { create } from 'zustand';
import type { LngLat } from '../../core/model/schema';
import { mapRef, setViewSaveGuard, whenMapReady } from '../../map/MapView';
import type { MaplibreMap } from '../../map/engine';
import { mutate, useProject } from '../../core/store/project';
import { uid, nowIso } from '../../core/model/factory';
import { toast, useUi } from '../../core/store/ui';
import { onBeforeClose } from '../../core/store/route';
import { formatDateTime, t } from '../../i18n';
import { usePrefs } from '../../core/store/prefs';
import { distanceM } from '../../core/geo/geo';
import { useCompass } from './compass';

/**
 * Own position, device-local only. Nothing here is written to the plan or sent to peers
 * unless the user explicitly saves a recorded path. While Streamer Safe or a briefing is
 * on, the position is hidden everywhere — including the camera (no follow, no locate).
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
    /** Set when saving the recording was refused (read-only, limits); offers "discard". */
    saveFailed: boolean;
    now: number;
}

export const useGps = create<GpsState>(() => ({ active: false, follow: false, fix: null, error: null, recording: null, saveFailed: false, now: Date.now() }));

let watchId: number | null = null;
/** Last point the camera was centred on by follow: a view around it is the own position. */
let followedAt: LngLat | null = null;
let resumeOnVisible = false;
let ticker = 0;

export const STALE_MS = 30000;
const MAX_TRACK_POINTS = 50000;

export function isStale(fix: Fix | null, now = Date.now()): boolean {
    return !fix || now - fix.at > STALE_MS;
}

/** A fix that may be shown as "here": GPS on and fresh. */
export function liveFix(state = useGps.getState()): Fix | null {
    return state.active && state.fix && !isStale(state.fix, Math.max(state.now, Date.now())) ? state.fix : null;
}

/** Streamer Safe and briefings hide the own position (shared screens). */
export function positionHidden(): boolean {
    const ui = useUi.getState();
    return ui.streamer !== 'off' || ui.mode === 'briefing';
}

function followCamera(fix: Fix) {
    const map = mapRef.current;
    if (!map || positionHidden()) {
        return;
    }
    const compass = useCompass.getState();
    // Heading-up and follow in one camera move, so neither cancels the other.
    const bearing = compass.headingUp && compass.heading !== null ? compass.heading : map.getBearing();
    followedAt = fix.p;
    map.easeTo({ center: fix.p, bearing, duration: 400 });
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
    if (recording && fix.accuracy <= 50 && recording.points.length < MAX_TRACK_POINTS) {
        const last = recording.points[recording.points.length - 1];
        if (!last || distanceM(last.p, fix.p) >= Math.max(3, fix.accuracy / 3)) {
            recording = { ...recording, points: [...recording.points, { p: fix.p, t: new Date(fix.at).toISOString(), acc: Math.round(fix.accuracy) }] };
        }
    }
    useGps.setState({ fix, error: null, recording, now: Date.now() });
    if (state.follow) {
        followCamera(fix);
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
    useGps.setState({ active: true, follow: follow && !positionHidden() });
}

/** GPS off: the last fix is dropped, so nothing keeps presenting it as current. */
export function stopGps() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    window.clearInterval(ticker);
    useGps.setState({ active: false, follow: false, fix: null, now: Date.now() });
}

/** First press starts GPS and follows; later presses toggle following. GPS stops only explicitly. */
export function locateOnce() {
    if (positionHidden()) {
        toast(t('field.hiddenNow'), { tone: 'warn' });
        return;
    }
    const state = useGps.getState();
    if (!state.active) {
        startGps(true);
        return;
    }
    const follow = !state.follow;
    useGps.setState({ follow });
    const fix = liveFix();
    if (follow && fix) {
        followCamera(fix);
    }
}

export function startRecording() {
    startGps(useGps.getState().follow);
    useGps.setState({ recording: { startedAt: nowIso(), points: [] }, saveFailed: false });
}

/** Save (or discard) the recording. Returns true when a track was stored. */
export function stopRecording(save: boolean): boolean {
    const recording = useGps.getState().recording;
    if (!recording) {
        return false;
    }
    if (!save) {
        useGps.setState({ recording: null, saveFailed: false });
        return false;
    }
    if (recording.points.length < 2) {
        useGps.setState({ recording: null, saveFailed: false });
        toast(t('field.trackTooShort'));
        return false;
    }
    // Own tracks are local records, not plan edits: no undo step (an undo would delete the path).
    const saved = mutate(t('field.track'), (draft) => {
        draft.tracks.push({ id: uid('trk'), name: formatDateTime(recording.startedAt, usePrefs.getState().locale), startedAt: recording.startedAt, endedAt: nowIso(), points: recording.points.slice(0, MAX_TRACK_POINTS) });
    }, { noHistory: true });
    if (!saved) {
        useGps.setState({ saveFailed: true });
        toast(useProject.getState().readOnly ? t('save.readOnlyCopy') : t('field.trackSaveFailed'), { tone: 'warn' });
        return false;
    }
    useGps.setState({ recording: null, saveFailed: false });
    toast(t('field.trackSaved', { n: recording.points.length }), { tone: 'ok' });
    return true;
}

/**
 * GPS pauses while the app is hidden (battery, privacy) and resumes only if it was on.
 * Entering Streamer Safe or a briefing stops following and heading-up. A running recording
 * is saved before the plan closes.
 */
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
    const stopHeadingUp = (event: { originalEvent?: unknown }) => {
        // Only a rotation by the user ends heading-up, not our own camera moves.
        if (event.originalEvent && useCompass.getState().headingUp) {
            useCompass.setState({ headingUp: false });
        }
    };
    let map: MaplibreMap | null = null;
    const stopReady = whenMapReady((ready) => {
        map = ready;
        ready.on('dragstart', stopFollow);
        ready.on('rotatestart', stopHeadingUp);
    });
    const unsubUi = useUi.subscribe((state, prev) => {
        if ((state.streamer !== prev.streamer || state.mode !== prev.mode) && positionHidden()) {
            useGps.setState({ follow: false });
            useCompass.setState({ headingUp: false });
        }
    });
    // Never remember a camera that is just the own position (rule 5): not while following, and
    // not afterwards either while the view is still centred on the last followed point.
    setViewSaveGuard(() => {
        if (useGps.getState().follow) {
            return false;
        }
        const current = mapRef.current?.getCenter();
        return !followedAt || !current || distanceM([current.lng, current.lat], followedAt) > 50;
    });
    const stopBeforeClose = onBeforeClose(() => {
        if (useGps.getState().recording) {
            stopRecording(true);
        }
    });
    return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        stopReady();
        unsubUi();
        stopBeforeClose();
        setViewSaveGuard(null);
        map?.off('dragstart', stopFollow);
        map?.off('rotatestart', stopHeadingUp);
        stopGps();
        useGps.setState({ recording: null, fix: null, saveFailed: false });
    };
}
