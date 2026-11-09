import { create } from 'zustand';

/**
 * Device compass. Only north-referenced sources are shown as a heading:
 * iOS `webkitCompassHeading` (magnetic) or `deviceorientationabsolute` (Android).
 * A relative gyro heading is never presented as north.
 */
interface CompassState {
    active: boolean;
    heading: number | null;
    accuracy: number | null;
    source: 'ios' | 'absolute' | null;
    permission: 'unknown' | 'granted' | 'denied' | 'unsupported';
    headingUp: boolean;
}

export const useCompass = create<CompassState>(() => ({ active: false, heading: null, accuracy: null, source: null, permission: 'unknown', headingUp: false }));

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

let listening: { type: string; fn: (event: Event) => void } | null = null;
let smoothed: number | null = null;
/** Bumped by every start/stop, so a start that resolves after a stop never attaches a listener. */
let generation = 0;
let probe = 0;

function screenAngle(): number {
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    return Number(angle) || 0;
}

function update(heading: number, accuracy: number | null, source: 'ios' | 'absolute') {
    const corrected = (heading + screenAngle() + 360) % 360;
    // Low-pass filter on the circle so the needle does not jitter.
    if (smoothed === null) {
        smoothed = corrected;
    } else {
        const delta = ((corrected - smoothed + 540) % 360) - 180;
        smoothed = (smoothed + delta * 0.25 + 360) % 360;
    }
    useCompass.setState({ heading: smoothed, accuracy, source });
}

const onIos = (event: Event) => {
    const e = event as OrientationEvent;
    if (typeof e.webkitCompassHeading === 'number') {
        update(e.webkitCompassHeading, typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null, 'ios');
    }
};

const onAbsolute = (event: Event) => {
    const e = event as OrientationEvent;
    if (e.absolute && typeof e.alpha === 'number') {
        update((360 - e.alpha) % 360, null, 'absolute');
    }
};

/**
 * Must be called from a user gesture (iOS permission prompt). Resolves false when the sensor
 * is missing or not allowed; `onSilent` runs if no north-referenced reading arrives in 3 s
 * (desktop without sensors, or a browser that only offers relative orientation).
 */
export async function startCompass(onSilent?: () => void): Promise<boolean> {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
        useCompass.setState({ permission: 'unsupported' });
        return false;
    }
    const token = ++generation;
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    if (typeof api.requestPermission === 'function') {
        const result = await api.requestPermission().catch(() => 'denied' as const);
        if (result !== 'granted') {
            useCompass.setState({ permission: 'denied' });
            return false;
        }
    }
    if (token !== generation) {
        // Stopped (workspace closed) while the permission prompt was open.
        return false;
    }
    detach();
    smoothed = null;
    const absolute = 'ondeviceorientationabsolute' in window;
    listening = absolute ? { type: 'deviceorientationabsolute', fn: onAbsolute } : { type: 'deviceorientation', fn: onIos };
    window.addEventListener(listening.type, listening.fn);
    useCompass.setState({ active: true, permission: 'granted', heading: null });
    window.clearTimeout(probe);
    probe = window.setTimeout(() => {
        if (token === generation && useCompass.getState().heading === null) {
            stopCompass();
            useCompass.setState({ permission: 'unsupported' });
            onSilent?.();
        }
    }, 3000);
    return true;
}

function detach() {
    if (listening) {
        window.removeEventListener(listening.type, listening.fn);
        listening = null;
    }
}

export function stopCompass() {
    generation += 1;
    window.clearTimeout(probe);
    detach();
    useCompass.setState({ active: false, heading: null, headingUp: false });
}
