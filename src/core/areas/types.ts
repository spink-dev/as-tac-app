import type { Bounds } from '../geo/geo';

/** Offline basemap package. Compatible with the `.astac-map.json` format of as-tac ≤ 0.6. */
export interface AreaPackage {
    format: 'as-tac-map';
    formatVersion: 1;
    id: string;
    name: string;
    bounds: Bounds;
    dataTimestamp: string;
    source: string;
    attribution: '© OpenStreetMap contributors';
    license: 'ODbL 1.0';
    byteSize: number;
    sha256: string;
    /** SHA-256 of the sanitized data (what an import compares against, see importAreaPackage). */
    contentSha256?: string;
    featureCount?: number;
    origin?: 'bundled' | 'download' | 'import' | 'legacy';
    installedAt?: string;
    data: GeoJSON.FeatureCollection;
}

export type AreaMeta = Omit<AreaPackage, 'data'>;

export interface BundledArea {
    id: string;
    name: string;
    bounds: Bounds;
    file: string;
    approxBytes: number;
    description: string;
}
