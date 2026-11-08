import type { ImageSource, Map as MlMap } from 'maplibre-gl';
import type { ImageOverlay } from '../core/model/schema';
import { assetUrl } from '../core/storage/assets';
import { FIRST_PLAN_LAYER } from './planLayers';

const PREFIX = 'img-';
const pending = new Set<string>();

function layerId(id: string) {
    return `${PREFIX}${id}`;
}

/** Keep MapLibre image sources in sync with the project's image maps (below every plan layer). */
export async function syncImageOverlays(map: MlMap, images: ImageOverlay[], hidden: boolean) {
    const wanted = new Set(hidden ? [] : images.filter((image) => image.visible).map((image) => image.id));
    for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.id.startsWith(PREFIX) && !wanted.has(layer.id.slice(PREFIX.length))) {
            map.removeLayer(layer.id);
            if (map.getSource(layer.id)) {
                map.removeSource(layer.id);
            }
        }
    }
    for (const image of images) {
        if (!wanted.has(image.id)) {
            continue;
        }
        const id = layerId(image.id);
        const source = map.getSource(id) as ImageSource | undefined;
        if (source) {
            const current = (source as unknown as { coordinates: number[][] }).coordinates;
            if (JSON.stringify(current) !== JSON.stringify(image.corners)) {
                source.setCoordinates(image.corners);
            }
            map.setPaintProperty(id, 'raster-opacity', image.opacity);
            continue;
        }
        if (pending.has(id)) {
            continue;
        }
        pending.add(id);
        try {
            const url = await assetUrl(image.asset);
            if (!url || map.getSource(id)) {
                continue;
            }
            map.addSource(id, { type: 'image', url, coordinates: image.corners });
            map.addLayer(
                { id, type: 'raster', source: id, paint: { 'raster-opacity': image.opacity, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
                map.getLayer(FIRST_PLAN_LAYER) ? FIRST_PLAN_LAYER : undefined,
            );
        } finally {
            pending.delete(id);
        }
    }
    // Respect project order: later images draw above earlier ones.
    for (const image of images) {
        const id = layerId(image.id);
        if (map.getLayer(id) && map.getLayer(FIRST_PLAN_LAYER)) {
            map.moveLayer(id, FIRST_PLAN_LAYER);
        }
    }
}
