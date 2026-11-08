import { useUi } from '../../core/store/ui';
import { useProject } from '../../core/store/project';
import { flyTo } from '../../map/MapView';
import { broadcastBriefing } from '../../core/live/briefingSync';

export function goToPhase(index: number, fromRemote = false) {
    const project = useProject.getState().project;
    if (!project || project.phases.length === 0) {
        return;
    }
    const clamped = Math.max(0, Math.min(project.phases.length - 1, index));
    const ui = useUi.getState();
    // Temporary marks belong to the phase they were drawn on.
    ui.set({ phaseIndex: clamped, briefingInk: clamped === ui.phaseIndex ? ui.briefingInk : [] });
    const camera = project.phases[clamped].camera;
    if (camera) {
        flyTo(camera);
    }
    if (!fromRemote) {
        broadcastBriefing();
    }
}

export function stepPhase(delta: number) {
    goToPhase(useUi.getState().phaseIndex + delta);
}
