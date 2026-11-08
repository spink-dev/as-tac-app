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

/** Must be called from a user gesture (iOS permission prompt). */
export async function startCompass(): Promise<boolean> {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
        useCompass.setState({ permission: 'unsupported' });
        return false;
    }
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    if (typeof api.requestPermission === 'function') {
        const result = await api.requestPermission().catch(() => 'denied' as const);
        if (result !== 'granted') {
            useCompass.setState({ permission: 'denied' });
            return false;
        }
    }
    stopCompass();
    smoothed = null;
    const absolute = 'ondeviceorientationabsolute' in window;
    listening = absolute ? { type: 'deviceorientationabsolute', fn: onAbsolute } : { type: 'deviceorientation', fn: onIos };
    window.addEventListener(listening.type, listening.fn);
    useCompass.setState({ active: true, permission: 'granted' });
    return true;
}

export function stopCompass() {
    if (listening) {
        window.removeEventListener(listening.type, listening.fn);
        listening = null;
    }
    useCompass.setState({ active: false, heading: null, headingUp: false });
}
