import type { Bounds } from '../geo/geo';

/**
 * Area package format (`.astac-map.json`, also inside `.astac`). `AREA_STEPS[n]` turns version n into
 * n+1 (see model/migrations.ts); readers refuse packages from a newer app ('area-newer').
 * Installed areas (IndexedDB `areas`/`areaMeta`) are stored in this format too: changing it also
 * needs a database version in storage/db.ts that upgrades the stored rows.
 */
export const AREA_FORMAT_VERSION = 1;
export const AREA_STEPS: Readonly<Record<number, (pkg: Record<string, unknown>) => Record<string, unknown>>> = {};

/** Offline basemap package. Compatible with the `.astac-map.json` format of as-tac ≤ 0.6. */
export interface AreaPackage {
    format: 'as-tac-map';
    formatVersion: typeof AREA_FORMAT_VERSION;
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

/** A prepared field of the catalog (src/config/maps.json, see areas/catalog.ts). */
export interface BundledArea {
    id: string;
    name: string;
    /** ISO 3166-1 alpha-2. */
    country: string;
    /** Municipality or nearest town. */
    place: string;
    /** The operator's site, when known. */
    website?: string;
    /** The field itself in OpenStreetMap (`way/123`), when it is mapped there. */
    osm?: string;
    bounds: Bounds;
    /** Served path of the GeoJSON; `bytes` and `sha256` describe exactly that file. */
    file: string;
    bytes: number;
    featureCount: number;
    sha256: string;
    dataTimestamp: string;
    source: string;
}
