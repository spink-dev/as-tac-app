import type { Theme } from '../appearance/theme';

export const palettes = {
    light: {
        background: '#e5e8e6',
        building: '#a6adad',
        land: '#c4cec4',
        water: '#a6c8d0',
        waterLine: '#668d9b',
        roadEdge: '#9aa09e',
        road: '#f8f9f7',
        gps: '#176b89',
    },
    dark: {
        background: '#171c20',
        building: '#444c53',
        land: '#26362f',
        water: '#203946',
        waterLine: '#466879',
        roadEdge: '#22292d',
        road: '#667079',
        gps: '#75bdd7',
    },
    // Neutral inputs for the red display transform; persisted object/team colors are untouched.
    red: {
        background: '#0b0b0b',
        building: '#393939',
        land: '#1e1e1e',
        water: '#151515',
        waterLine: '#515151',
        roadEdge: '#151515',
        road: '#777777',
        gps: '#d0d0d0',
    },
} satisfies Record<Theme, Record<string, string>>;
