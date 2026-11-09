import type { Appearance } from '../core/store/prefs';

export interface Palette {
    background: string;
    wood: string;
    scrub: string;
    grass: string;
    farm: string;
    residential: string;
    industrial: string;
    water: string;
    waterLine: string;
    building: string;
    buildingLine: string;
    roadCase: string;
    road: string;
    major: string;
    track: string;
    path: string;
    rail: string;
    barrier: string;
    label: string;
    labelHalo: string;
    poi: string;
    grid: string;
    gridLabel: string;
    selection: string;
    handle: string;
    handleLine: string;
    gps: string;
    draft: string;
}

export const PALETTES: Record<Appearance, Palette> = {
    // Daylight on a phone outdoors: strong road and path contrast, muted landcover.
    day: {
        background: '#e8ebe6',
        wood: '#bfd1b8',
        scrub: '#cddbc0',
        grass: '#d9e4cc',
        farm: '#ece9d8',
        residential: '#e1e2e0',
        industrial: '#dcdae2',
        water: '#a7c9de',
        waterLine: '#5a8cae',
        building: '#b9b6ae',
        buildingLine: '#8f8b82',
        roadCase: '#9b9a94',
        road: '#ffffff',
        major: '#f7dc94',
        track: '#7d6a4c',
        path: '#6e5f49',
        rail: '#7d7d7d',
        barrier: '#8a7f73',
        label: '#22262a',
        labelHalo: '#ffffff',
        poi: '#4b5258',
        grid: '#1b4f8a',
        gridLabel: '#0f3a6b',
        selection: '#ac3c0e',
        handle: '#ffffff',
        handleLine: '#ac3c0e',
        gps: '#1565c0',
        draft: '#ac3c0e',
    },
    dark: {
        background: '#191e22',
        wood: '#21302a',
        scrub: '#243028',
        grass: '#262f27',
        farm: '#292b25',
        residential: '#23262a',
        industrial: '#26242e',
        water: '#1c3343',
        waterLine: '#3e6a84',
        building: '#3a4147',
        buildingLine: '#525b63',
        roadCase: '#121619',
        road: '#5c656e',
        major: '#8a7446',
        track: '#a38f6a',
        path: '#9a8a6d',
        rail: '#6a6e72',
        barrier: '#7e766b',
        label: '#d7dce0',
        labelHalo: '#12161a',
        poi: '#aab3bb',
        grid: '#6fa8dc',
        gridLabel: '#9cc7ee',
        selection: '#ef8c62',
        handle: '#191e22',
        handleLine: '#ef8c62',
        gps: '#64b5f6',
        draft: '#ef8c62',
    },
    // Neutral luminance inputs; the red-light filter maps them to red without losing contrast.
    red: {
        background: '#0c0c0c',
        wood: '#1b1b1b',
        scrub: '#1a1a1a',
        grass: '#171717',
        farm: '#151515',
        residential: '#191919',
        industrial: '#1b1b1b',
        water: '#101010',
        waterLine: '#4a4a4a',
        building: '#333333',
        buildingLine: '#4a4a4a',
        roadCase: '#0c0c0c',
        road: '#6a6a6a',
        major: '#858585',
        track: '#8a8a8a',
        path: '#7c7c7c',
        rail: '#555555',
        barrier: '#5c5c5c',
        label: '#c4c4c4',
        labelHalo: '#0c0c0c',
        poi: '#a0a0a0',
        grid: '#9a9a9a',
        gridLabel: '#c0c0c0',
        selection: '#ffffff',
        handle: '#0c0c0c',
        handleLine: '#e0e0e0',
        gps: '#ffffff',
        draft: '#ffffff',
    },
};
