import { MapView } from '../../map/MapView';
import { useUi } from '../../core/store/ui';
import { usePrefs } from '../../core/store/prefs';
import { TopBar } from './TopBar';
import { MapHud, Readout } from './MapHud';

export function Workspace() {
    const mode = useUi((state) => state.mode);
    const streamer = useUi((state) => state.streamer);
    const appearance = usePrefs((state) => state.appearance);
    return (
        <div className="ws" data-mode={mode} data-streamer={streamer} data-appearance-map={appearance}>
            <MapView />
            <TopBar />
            <MapHud />
            <Readout />
            <div className="attribution">© OpenStreetMap</div>
        </div>
    );
}
