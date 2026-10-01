import { useCallback, useEffect, useState } from 'react';
import presets from '../../config/maps.json';
import { ProjectDatabase } from '../projects/database';
import { loadMap, type MapPackage } from './maps';
export function useMaps(id: string) {
    const [areas, setAreas] = useState<{ id: string; name: string; bounds: number[]; byteSize?: number }[]>(presets);
    const [current, setCurrent] = useState<MapPackage | null>(null);
    const [error, setError] = useState(false);
    const [loading, setLoading] = useState(true);
    const refresh = useCallback(async () => {
        const db = await ProjectDatabase.open();
        try {
            setAreas([...presets, ...await db.listMaps()]);
        } finally {
            db.close();
        }
    }, []);
    useEffect(() => {
        void refresh().catch(() => {
            // Preset maps still work when local project storage is unavailable.
        });
    }, [refresh]);
    useEffect(() => {
        const abort = new AbortController();
        setLoading(true);
        setError(false);
        void loadMap(id, abort.signal).then((pkg) => {
            if (!abort.signal.aborted) {
                setCurrent(pkg);
                setLoading(false);
            }
        }).catch(() => {
            if (!abort.signal.aborted) {
                setError(true);
                setLoading(false);
            }
        });
        return () => abort.abort();
    }, [id]);
    return { areas, current, error, loading, refresh };
}
