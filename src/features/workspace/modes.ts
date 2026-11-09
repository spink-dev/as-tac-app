import { useUi, type Mode } from '../../core/store/ui';
import { useProject } from '../../core/store/project';
import { flyTo } from '../../map/MapView';

/**
 * Switching modes never loses work: drafts are dropped only when they cannot exist in the
 * target mode, and leaving a briefing discards temporary ink only (explicit, documented).
 */
export function setMode(mode: Mode) {
    const ui = useUi.getState();
    if (ui.mode === mode) {
        return;
    }
    const patch: Partial<ReturnType<typeof useUi.getState>> = { mode, draft: null };
    if (mode !== 'plan') {
        patch.tool = 'select';
        // Alignment edits plan data: it never survives leaving plan mode.
        patch.imageEditId = null;
    }
    if (ui.mode === 'briefing') {
        patch.briefingInk = [];
    }
    if (mode === 'briefing') {
        patch.phaseIndex = 0;
        patch.selection = [];
        patch.panel = null;
        patch.sheet = 'closed';
        const project = useProject.getState().project;
        const camera = project?.phases[0]?.camera;
        if (camera) {
            flyTo(camera);
        }
    }
    if (mode === 'field') {
        patch.panel = null;
        patch.sheet = 'closed';
    }
    ui.set(patch);
}
