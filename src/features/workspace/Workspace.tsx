import { MapView } from '../../map/MapView';
import { useUi } from '../../core/store/ui';
import { usePrefs } from '../../core/store/prefs';
import { TopBar } from './TopBar';
import { MapHud, Readout } from './MapHud';
import { ContextBar, DraftBar, HintBar, ToolRail } from './Tools';
import { useShortcuts } from './useShortcuts';
import { PanelHost } from '../panels/Panel';
import { CommandPalette } from './CommandPalette';
import { AlignBar } from '../maps/AlignBar';
import { BriefingBar } from '../briefing/BriefingBar';
import { FieldPanel, useFieldLayers } from '../field/FieldHud';
import '../maps/MapsPanel';
import '../briefing/PhasesPanel';
import '../share/SharePanel';
import '../live/LivePanel';
import { useEffect } from 'react';
import { connectLive, disconnectLive } from '../../core/live/session';
import { useProject } from '../../core/store/project';

export function Workspace() {
    const mode = useUi((state) => state.mode);
    const streamer = useUi((state) => state.streamer);
    const appearance = usePrefs((state) => state.appearance);
    useShortcuts();
    useFieldLayers();
    const projectId = useProject((state) => state.project?.id);
    useEffect(() => {
        if (!projectId) {
            return;
        }
        void connectLive(projectId);
        return () => {
            void disconnectLive();
        };
    }, [projectId]);
    return (
        <div className="ws" data-mode={mode} data-streamer={streamer} data-appearance-map={appearance}>
            <MapView />
            <TopBar />
            <MapHud />
            <ToolRail />
            <div className="ws-bottom">
                <AlignBar />
                <BriefingBar />
                <FieldPanel />
                <DraftBar />
                <HintBar />
                <ContextBar />
            </div>
            {streamer === 'off' ? <Readout /> : null}
            <PanelHost />
            <CommandPalette />
            <div className="attribution">© OpenStreetMap</div>
        </div>
    );
}
