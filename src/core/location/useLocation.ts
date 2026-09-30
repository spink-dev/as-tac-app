import { de } from '../../i18n/de';
import { useEffect, useRef, useState } from 'react';
import { STALE_MS, validFix, type Fix } from './position';

export function useLocation() {
    const watch = useRef<number | null>(null);
    const [fix, setFix] = useState<Fix | null>(null);
    const [now, setNow] = useState(Date.now());
    const [gps, setGps] = useState(de.location.idle);
    const [gpsError, setGpsError] = useState(false);
    const [active, setActive] = useState(false);
    useEffect(() => {
        const clock = window.setInterval(() => setNow(Date.now()), 1000);
        return () => {
            clearInterval(clock);
            if (watch.current !== null) {
                navigator.geolocation.clearWatch(watch.current);
            }
        };
    }, []);
    function startGps() {
        if (!isSecureContext || !navigator.geolocation) {
            setGps(de.location.unsupported);
            setGpsError(true);
            return;
        }
        if (watch.current !== null) {
            navigator.geolocation.clearWatch(watch.current);
        }
        setGps(de.location.waiting);
        setGpsError(false);
        setActive(true);
        watch.current = navigator.geolocation.watchPosition((position) => {
            const next = { longitude: position.coords.longitude, latitude: position.coords.latitude,
                accuracy: position.coords.accuracy, timestamp: position.timestamp };
            if (!validFix(next)) {
                setGps(de.location.invalid);
                setGpsError(true);
                return;
            }
            setFix(next);
            setNow(Date.now());
            setGps(de.location.received);
            setGpsError(false);
        }, (error) => {
            setGps(error.code === 1 ? de.location.denied
                : error.code === 3 ? de.location.timeout
                    : de.location.unavailable);
            setGpsError(true);
            if (error.code === 1) {
                if (watch.current !== null) {
                    navigator.geolocation.clearWatch(watch.current);
                    watch.current = null;
                }
                setActive(false);
            }
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    }

    function stopGps() {
        if (watch.current !== null) {
            navigator.geolocation.clearWatch(watch.current);
            watch.current = null;
        }
        setActive(false);
        setGps(de.location.stopped);
    }

    const stale = fix !== null && (now - fix.timestamp > STALE_MS || gpsError || !active);
    return { fix, now, gps, active, stale, startGps, stopGps };
}
