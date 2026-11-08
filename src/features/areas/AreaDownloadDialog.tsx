import { useEffect, useId, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { Search, WifiOff } from 'lucide-react';
import { useT, formatBytes } from '../../i18n';
import { usePrefs } from '../../core/store/prefs';
import { useDialogs } from '../../core/store/dialogs';
import { Button, CountUp, Dialog, Field, ICON } from '../../ui/components';
import { MaplibreMap } from '../../map/engine';
import { areaKm2, downloadArea, MAX_AREA_KM2, slugId, type DownloadPhase } from '../../core/areas/overpass';
import { searchPlaces, type PlaceResult } from '../../core/areas/search';
import { saveArea } from '../../core/areas/store';
import { boundsSizeM, formatDistance, type Bounds } from '../../core/geo/geo';
import { toast } from '../../core/store/ui';
import { mapRef } from '../../map/MapView';

function onlineStyle() {
    return {
        version: 8 as const,
        sources: {
            osm: {
                type: 'raster' as const,
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
                attribution: '© OpenStreetMap-Mitwirkende',
            },
        },
        layers: [
            { id: 'bg', type: 'background' as const, paint: { 'background-color': '#dfe3df' } },
            { id: 'osm', type: 'raster' as const, source: 'osm' },
        ],
    };
}

export function AreaDownloadDialog() {
    const t = useT();
    const locale = usePrefs((state) => state.locale);
    const open = useDialogs((state) => state.open === 'areaDownload');
    const payload = useDialogs((state) => state.payload as { returnTo?: 'newPlan' } | null);
    const hide = useDialogs((state) => state.hide);
    const show = useDialogs((state) => state.show);
    const container = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLDivElement>(null);
    const map = useRef<MlMap | null>(null);
    const [bounds, setBounds] = useState<Bounds | null>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<PlaceResult[] | null>(null);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState<{ phase: DownloadPhase; bytes: number } | null>(null);
    const [online, setOnline] = useState(navigator.onLine);
    const abort = useRef<AbortController | null>(null);
    const nameId = useId();
    const searchId = useId();

    useEffect(() => {
        const update = () => setOnline(navigator.onLine);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        // The dialog's body mounts on open; wait a frame for its layout.
        const id = requestAnimationFrame(() => {
            if (!container.current) {
                return;
            }
            const start = mapRef.current?.getCenter();
            const instance = new MaplibreMap({
                container: container.current,
                style: onlineStyle(),
                center: start ? [start.lng, start.lat] : [8.54, 47.37],
                zoom: start ? Math.max(12, (mapRef.current?.getZoom() ?? 14) - 1) : 12,
                maxPitch: 0,
                dragRotate: false,
                attributionControl: { compact: true },
            });
            instance.touchZoomRotate.disableRotation();
            const update = () => {
                const box = frame.current?.getBoundingClientRect();
                const host = container.current?.getBoundingClientRect();
                if (!box || !host) {
                    return;
                }
                const sw = instance.unproject([box.left - host.left, box.bottom - host.top]);
                const ne = instance.unproject([box.right - host.left, box.top - host.top]);
                setBounds([sw.lng, sw.lat, ne.lng, ne.lat]);
            };
            instance.on('move', update);
            instance.on('load', update);
            map.current = instance;
        });
        return () => {
            cancelAnimationFrame(id);
            abort.current?.abort();
            map.current?.remove();
            map.current = null;
            setResults(null);
            setBusy(null);
            setQuery('');
            setName('');
        };
    }, [open]);

    async function runSearch() {
        try {
            setResults(await searchPlaces(query, locale));
        } catch {
            toast(t('area.searchFailed'), { tone: 'warn' });
        }
    }

    function pick(result: PlaceResult) {
        setResults(null);
        setName(result.name);
        if (result.bounds && areaKm2(result.bounds) < MAX_AREA_KM2 * 4) {
            map.current?.fitBounds([[result.bounds[0], result.bounds[1]], [result.bounds[2], result.bounds[3]]], { padding: 80, duration: 600 });
        } else {
            map.current?.flyTo({ center: result.center, zoom: 14.5, duration: 600 });
        }
    }

    async function download() {
        if (!bounds) {
            return;
        }
        const areaName = name.trim() || query.trim() || 'Gebiet';
        const controller = new AbortController();
        abort.current = controller;
        setBusy({ phase: 'download', bytes: 0 });
        try {
            const pkg = await downloadArea({
                id: slugId(areaName),
                name: areaName,
                bounds,
                signal: controller.signal,
                onProgress: (phase, bytes) => setBusy({ phase, bytes }),
            });
            const meta = await saveArea(pkg);
            toast(t('area.saved', { name: meta.name }), { tone: 'ok' });
            window.dispatchEvent(new Event('as-tac:library-changed'));
            if (payload?.returnTo === 'newPlan') {
                show('newPlan', { areaId: meta.id });
            } else {
                hide();
            }
        } catch (error) {
            if (controller.signal.aborted) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            toast(message.startsWith('rate-limit') ? t('area.rateLimit') : message === 'offline' ? t('area.needsNetwork') : t('area.failed', { reason: message }), { tone: 'danger' });
            setBusy(null);
        }
    }

    const km2 = bounds ? areaKm2(bounds) : 0;
    const size = bounds ? boundsSizeM(bounds) : null;
    const tooLarge = km2 > MAX_AREA_KM2;

    return (
        <Dialog
            open={open}
            wide
            onClose={() => {
                abort.current?.abort();
                hide();
            }}
            title={t('area.title')}
            footer={(
                <>
                    <span className="area-dl__size num" aria-live="polite">
                        {size ? t('area.size', { w: formatDistance(size.width), h: formatDistance(size.height) }) : null}
                        {tooLarge ? <strong className="area-dl__warn"> · {t('area.tooLarge', { max: MAX_AREA_KM2 })}</strong> : km2 > 0 ? ` · ${km2.toFixed(1)} km²` : null}
                    </span>
                    <div className="spacer" />
                    <Button variant="ghost" onClick={hide}>{t('common.cancel')}</Button>
                    <Button variant="primary" disabled={!online || tooLarge || !bounds || busy !== null} onClick={() => void download()} data-testid="download-area">
                        {t('area.download')}
                    </Button>
                </>
            )}
        >
            <p className="muted">{t('area.lead')}</p>
            {!online ? (
                <div className="notice notice--warn"><WifiOff {...ICON} /><span>{t('area.needsNetwork')}</span></div>
            ) : null}
            <div className="area-dl__row">
                <form className="area-dl__search" role="search" onSubmit={(event) => {
                    event.preventDefault();
                    void runSearch();
                }}>
                    <label htmlFor={searchId} className="sr-only">{t('area.search')}</label>
                    <input id={searchId} className="input" value={query} placeholder={t('area.search')} onChange={(event) => setQuery(event.target.value)} />
                    <Button type="submit" disabled={!online}><Search {...ICON} /><span className="sr-only">{t('common.search')}</span></Button>
                    {results ? (
                        <ul className="menu area-dl__results" role="listbox">
                            {results.length === 0 ? <li className="menu__item muted">{t('area.noResults')}</li> : null}
                            {results.map((result, i) => (
                                <li key={`${result.name}-${i}`}>
                                    <button type="button" className="menu__item area-dl__result" onClick={() => pick(result)}>
                                        <span className="list-row__title">{result.name}</span>
                                        <span className="list-row__meta">{result.detail}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </form>
                <Field label={t('area.name')} htmlFor={nameId}>
                    <input id={nameId} className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Gelände Nord" />
                </Field>
            </div>
            <div className="area-dl__map">
                <div ref={container} className="area-dl__canvas" />
                <div ref={frame} className={`area-dl__frame ${tooLarge ? 'is-too-large' : ''}`} aria-hidden />
                {busy ? (
                    <div className="area-dl__busy">
                        <strong>{busy.phase === 'download' ? t('area.downloading') : t('area.converting')}</strong>
                        <span className="num"><CountUp value={busy.bytes} format={(n) => formatBytes(Math.round(n))} /></span>
                        <div className="progress progress--indeterminate"><div className="progress__bar" /></div>
                        <Button small variant="ghost" onClick={() => {
                            abort.current?.abort();
                            setBusy(null);
                        }}>{t('common.cancel')}</Button>
                    </div>
                ) : null}
            </div>
            <p className="field__hint">{t('area.attribution')} · Overpass API · Nominatim</p>
        </Dialog>
    );
}
