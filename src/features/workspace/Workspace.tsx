import { MapView } from '../../map/MapView';
import { useUi } from '../../core/store/ui';
import { usePrefs } from '../../core/store/prefs';
import { TopBar } from './TopBar';
import { MapHud, Readout } from './MapHud';
import { ContextBar, DraftBar, HintBar, ToolRail } from './Tools';
import { useShortcuts } from './useShortcuts';

export function Workspace() {
    const mode = useUi((state) => state.mode);
    const streamer = useUi((state) => state.streamer);
    const appearance = usePrefs((state) => state.appearance);
    useShortcuts();
    return (
        <div className="ws" data-mode={mode} data-streamer={streamer} data-appearance-map={appearance}>
            <MapView />
            <TopBar />
            <MapHud />
            <ToolRail />
            <div className="ws-bottom">
                <DraftBar />
                <HintBar />
                <ContextBar />
            </div>
            <Readout />
            <div className="attribution">© OpenStreetMap</div>
        </div>
    );
}
