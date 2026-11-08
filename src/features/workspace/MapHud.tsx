import { useEffect, useState } from 'react';
import { Minus, Navigation2, Plus } from 'lucide-react';
import { useT } from '../../i18n';
import { ICON, IconButton } from '../../ui/components';
import { mapRef, whenMapReady } from '../../map/MapView';
import { useUi } from '../../core/store/ui';
import { usePrefs } from '../../core/store/prefs';
import { toMgrs } from '../../core/geo/mgrs';
import { formatLngLat } from '../../core/geo/geo';
import type { LngLat } from '../../core/model/schema';
import { FieldHudButtons } from '../field/FieldHud';
import { useCompass } from '../field/compass';

/** Compass rose that also resets the map to north-up. */
export function NorthButton() {
    const t = useT();
    const [bearing, setBearing] = useState(0);
    useEffect(() => whenMapReady((map) => {
        const update = () => setBearing(map.getBearing());
        map.on('rotate', update);
        update();
    }), []);
    return (
        <IconButton label={t('field.northUp')} tipPos="left" onClick={() => {
            // North-up wins over heading-up (the compass keeps showing the heading arrow).
            useCompass.setState({ headingUp: false });
            mapRef.current?.easeTo({ bearing: 0, duration: 300 });
        }}>
            <span className="north" style={{ transform: `rotate(${-bearing}deg)` }}>
                <Navigation2 size={20} strokeWidth={1.75} />
                <span className="north__n">N</span>
            </span>
        </IconButton>
    );
}

export function MapHud() {
    const t = useT();
    const mode = useUi((state) => state.mode);
    return (
        <div className="hud-right" data-mode={mode}>
            <div className="hud hud--stack">
                <NorthButton />
                <span className="hud__sep only-fine" />
                <span className="only-fine">
                    <IconButton label="Zoom +" tipPos="left" onClick={() => mapRef.current?.zoomIn({ duration: 200 })}><Plus {...ICON} /></IconButton>
                </span>
                <span className="only-fine">
                    <IconButton label="Zoom −" tipPos="left" onClick={() => mapRef.current?.zoomOut({ duration: 200 })}><Minus {...ICON} /></IconButton>
                </span>
            </div>
            <FieldHudButtons />
            <span className="sr-only">{t('mode.plan')}</span>
        </div>
    );
}

function niceScale(metersPerPixel: number, maxPx: number) {
    const max = metersPerPixel * maxPx;
    const pow = 10 ** Math.floor(Math.log10(max));
    const step = [5, 2, 1].map((n) => n * pow).find((n) => n <= max) ?? pow;
    return { meters: step, px: step / metersPerPixel };
}

/** Scale bar plus MGRS / lat-lng readout of the cursor (desktop) or map centre (touch). */
export function Readout() {
    const cursor = useUi((state) => state.cursor);
    const coordFormat = usePrefs((state) => state.coordFormat);
    const set = usePrefs((state) => state.set);
    const [center, setCenter] = useState<LngLat | null>(null);
    const [scale, setScale] = useState<{ meters: number; px: number } | null>(null);
    useEffect(() => whenMapReady((map) => {
        const update = () => {
            const c = map.getCenter();
            setCenter([c.lng, c.lat]);
            const mpp = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
            setScale(niceScale(mpp, 96));
        };
        map.on('move', update);
        update();
    }), []);
    const fine = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
    const point = fine && cursor ? cursor : center;
    if (!point) {
        return null;
    }
    return (
        <button type="button" className="readout hud" onClick={() => set({ coordFormat: coordFormat === 'mgrs' ? 'latlng' : 'mgrs' })} title="MGRS ↔ WGS84">
            {scale ? (
                <span className="scalebar" aria-label={`${scale.meters} m`}>
                    <span className="scalebar__bar" style={{ width: scale.px }} />
                    <span className="num">{scale.meters >= 1000 ? `${scale.meters / 1000} km` : `${scale.meters} m`}</span>
                </span>
            ) : null}
            <span className="readout__coord data">{coordFormat === 'mgrs' ? toMgrs(point, 5) : formatLngLat(point)}</span>
            {!fine ? <span className="crosshair" aria-hidden /> : null}
        </button>
    );
}
