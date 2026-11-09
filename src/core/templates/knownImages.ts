import type { ControlPoint } from '../model/schema';

/**
 * Event maps that AS-TAC recognises by SHA-256 when a user imports their own copy
 * (e.g. from a TacMap project). The images themselves are NOT shipped with the app.
 * Control points: building corners of the FieldMaps safe zones (as-tac r2) and wind
 * turbine bases, fitted affine. Accuracy is the RMS of the fit, not a survey guarantee.
 */
export interface KnownImage {
    id: string;
    name: string;
    width: number;
    height: number;
    controlPoints: ControlPoint[];
    rmsM: number;
}

export const KNOWN_IMAGES: Record<string, KnownImage> = {
    b5f010c366ef50ca1a7aca9d5161f527e54a455c29a9ba6806c58f5d8afe8cfe: {
        id: 'mahlwinkel-dark-emergency-2026',
        name: 'Mahlwinkel – Dark Emergency 2026',
        width: 1280,
        height: 905,
        rmsM: 2.6,
        controlPoints: [
            { px: [191.75, 146.25], lngLat: [11.8149282, 52.3847357] },
            { px: [255, 192], lngLat: [11.8163876, 52.3840809] },
            { px: [188, 275], lngLat: [11.8147961, 52.3828971] },
            { px: [129.5, 228], lngLat: [11.8134656, 52.3835514] },
            { px: [1004.5, 148], lngLat: [11.8341821, 52.3846799] },
            { px: [1074.25, 165.5], lngLat: [11.8358065, 52.3843981] },
            { px: [1051.25, 260], lngLat: [11.8352437, 52.3829743] },
            { px: [965, 235.75], lngLat: [11.8332822, 52.3833754] },
            { px: [566.3, 480.5], lngLat: [11.8237549, 52.3798623] },
            { px: [617.5, 463.7], lngLat: [11.8249338, 52.3801134] },
            { px: [628.3, 505], lngLat: [11.8252173, 52.3794927] },
            { px: [576.7, 520], lngLat: [11.8239907, 52.3793008] },
        ],
    },
    '2db912ffcf3ee653decee45d76ea1ab10122d3acdd94f4de2a3868b79c1f216f': {
        id: 'mahlwinkel-mission-24-2026',
        name: 'Mahlwinkel – Mission 24H 2026',
        width: 3510,
        height: 2000,
        rmsM: 4.8,
        controlPoints: [
            { px: [457.3, 530], lngLat: [11.813599, 52.3829089] },
            { px: [1276, 528.3], lngLat: [11.82123, 52.3828796] },
            { px: [1986.3, 586.7], lngLat: [11.8277892, 52.3825468] },
            { px: [2622.7, 708.7], lngLat: [11.8337326, 52.3817796] },
            { px: [1945, 1160], lngLat: [11.8273727, 52.3792285] },
            { px: [1508, 295], lngLat: [11.823325, 52.384138] },
            { px: [2730, 408], lngLat: [11.834536, 52.383492] },
            { px: [1625, 1083], lngLat: [11.824478, 52.379629] },
        ],
    },
};

export function knownImage(hash: string, width: number, height: number): KnownImage | null {
    const entry = KNOWN_IMAGES[hash];
    return entry && entry.width === width && entry.height === height ? entry : null;
}
