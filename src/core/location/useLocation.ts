import { de } from '../../i18n/de';
import { useEffect, useRef, useState } from 'react';
import { STALE_MS, validFix, type Fix } from './position';

export function useLocation() {
    const watch = useRef<number | null>(null);
    const requested = useRef(false);
    const generation = useRef(0);
    const latest = useRef<Fix | null>(null);
    const [fix, setFix] = useState<Fix | null>(null);
    const [now, setNow] = useState(Date.now());
    const [gps, setGps] = useState(de.location.idle);
    const [gpsError, setGpsError] = useState(false);
    const [active, setActive] = useState(false);

    function clearWatch() {
        generation.current += 1;
        if (watch.current !== null) {
            navigator.geolocation.clearWatch(watch.current);
            watch.current = null;
        }
    }
    function beginWatch() {
        clearWatch();
        setNow(Date.now());
        setGpsError(true); // A previous fix stays stale until this watch supplies a fresh one.
        if (document.visibilityState === 'hidden') {
            setGps(de.location.suspended);
            return;
        }
        setGps(de.location.waiting);
        const current = generation.current;
        const id = navigator.geolocation.watchPosition((position) => {
            if (!requested.current || current !== generation.current) {
                return;
            }
            const next = { longitude: position.coords.longitude, latitude: position.coords.latitude,
                accuracy: position.coords.accuracy, timestamp: position.timestamp,
                speed: Number.isFinite(position.coords.speed) && position.coords.speed !== null && position.coords.speed >= 0 ? position.coords.speed : null };
            if (!validFix(next) || next.timestamp > Date.now() + 5_000) {
                setGps(de.location.invalid);
                setGpsError(true);
                return;
            }
            if (latest.current && next.timestamp < latest.current.timestamp) {
                return;
            }
            latest.current = next;
            setFix(next);
            setNow(Date.now());
            setGps(de.location.received);
            setGpsError(false);
        }, (error) => {
            if (!requested.current || current !== generation.current) {
                return;
            }
            setGps(error.code === 1 ? de.location.denied
                : error.code === 3 ? de.location.timeout
                    : de.location.unavailable);
            setGpsError(true);
            if (error.code === 1) {
                requested.current = false;
                clearWatch();
                setActive(false);
            }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
        if (requested.current && current === generation.current) {
            watch.current = id;
        } else {
            navigator.geolocation.clearWatch(id);
        }
    }
    useEffect(() => {
        const clock = window.setInterval(() => setNow(Date.now()), 1000);
        const suspend = () => {
            clearWatch();
            setNow(Date.now());
            if (requested.current) {
                setGpsError(true);
                setGps(de.location.suspended);
            }
        };
        const resume = () => {
            setNow(Date.now());
            if (requested.current && watch.current === null && document.visibilityState !== 'hidden') {
                beginWatch();
            }
        };
        const visibility = () => {
            if (document.visibilityState === 'hidden') {
                suspend();
            } else {
                resume();
            }
        };
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('pagehide', suspend);
        window.addEventListener('pageshow', resume);
        return () => {
            requested.current = false;
            clearInterval(clock);
            clearWatch();
            document.removeEventListener('visibilitychange', visibility);
            window.removeEventListener('pagehide', suspend);
            window.removeEventListener('pageshow', resume);
        };
    }, []);
    function startGps() {
        if (!isSecureContext || !navigator.geolocation) {
            setGps(de.location.unsupported);
            setGpsError(true);
            return;
        }
        requested.current = true;
        setActive(true);
        beginWatch();
    }
    function stopGps() {
        requested.current = false;
        clearWatch();
        setActive(false);
        setGps(de.location.stopped);
    }
    const stale = fix !== null && (now - fix.timestamp > STALE_MS || gpsError || !active);
    return { fix, now, gps, active, stale, startGps, stopGps };
}
