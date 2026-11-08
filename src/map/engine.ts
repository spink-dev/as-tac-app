import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// One place configures the MapLibre worker for every map instance in the app.
setWorkerUrl(workerUrl);

export { Map as MaplibreMap } from 'maplibre-gl';
