import { useEffect, useRef, useState } from 'react';
export function useMotion() {
    const [enabled, setEnabled] = useState(false);
    const [status, setStatus] = useState('Sensoren aus');
    const [magnitude, setMagnitude] = useState<number | null>(null);
    const token = useRef(0);
    useEffect(
        () => () => {
            token.current++;
        },
        [],
    );
    async function start() {
        const current = ++token.current;
        if (!isSecureContext || typeof DeviceMotionEvent === 'undefined') {
            setStatus('Bewegungssensoren nicht verfügbar');
            return;
        }
        try {
            const api = DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> };
            const granted = api.requestPermission ? await api.requestPermission() : 'granted';
            if (current !== token.current) {
                return;
            }
            if (granted !== 'granted') {
                setStatus('Sensorfreigabe abgelehnt');
                return;
            }
            setEnabled(true);
            setStatus('Warte auf Bewegungssensor …');
        } catch {
            if (current === token.current) {
                setStatus('Sensorfreigabe nicht möglich');
            }
        }
    }
    useEffect(() => {
        if (!enabled) {
            return;
        }
        let updated = 0,
            lastEvent = 0;
        const receive = (event: DeviceMotionEvent) => {
            if (document.visibilityState === 'hidden') {
                return;
            }
            const values = [event.acceleration?.x, event.acceleration?.y, event.acceleration?.z];
            if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
                return;
            }
            lastEvent = Date.now();
            if (lastEvent - updated < 250) {
                return;
            }
            updated = lastEvent;
            const value = Math.hypot(...(values as number[]));
            setMagnitude(value);
            setStatus(value > 1 ? 'Gerät bewegt sich' : 'Gerät momentan ruhig');
        };
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'hidden' || Date.now() - lastEvent > 2000) {
                setMagnitude(null);
                setStatus(document.visibilityState === 'hidden' ? 'Sensoren pausiert' : 'Keine aktuellen Bewegungsdaten');
            }
        }, 1000);
        window.addEventListener('devicemotion', receive);
        return () => {
            clearInterval(timer);
            window.removeEventListener('devicemotion', receive);
        };
    }, [enabled]);
    return {
        enabled,
        status,
        magnitude,
        start,
        stop: () => {
            token.current++;
            setEnabled(false);
            setMagnitude(null);
            setStatus('Sensoren aus');
        },
    };
}
