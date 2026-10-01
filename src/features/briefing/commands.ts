import type { Command } from '../../core/projects/commands';
import type { Phase, PlanElement, Project } from '../../core/projects/model';
export function savePhase(project: Project, phase: Phase): Command[] {
    const commands: Command[] = [{ kind: 'phase', id: phase.id, value: phase }];
    for (const element of project.elements) {
        const included = phase.visibleElementIds.includes(element.id);
        if (included !== element.phaseIds.includes(phase.id)) {
            commands.push({ kind: 'element', id: element.id, value: { ...element, version: element.version + 1,
                phaseIds: included ? [...element.phaseIds, phase.id] : element.phaseIds.filter((id) => id !== phase.id) } });
        }
    }
    return commands;
}
export function saveElement(project: Project, element: PlanElement): Command[] {
    const previous = project.elements.find((item) => item.id === element.id);
    const commands: Command[] = [{ kind: 'element', id: element.id, value: element }];
    for (const phase of project.phases) {
        const included = element.phaseIds.includes(phase.id);
        if (included !== (previous?.phaseIds.includes(phase.id) ?? false)) {
            commands.push({ kind: 'phase', id: phase.id, value: { ...phase,
                visibleElementIds: included ? [...new Set([...phase.visibleElementIds, element.id])] : phase.visibleElementIds.filter((id) => id !== element.id) } });
        }
    }
    return commands;
}
export function removeTeam(project: Project, id: string): Command[] {
    return [...project.elements.filter((element) => element.teamId === id).map((element): Command => ({ kind: 'element', id: element.id, value: { ...element, teamId: undefined, version: element.version + 1 } })), { kind: 'team', id, value: null }];
}
export function removePhase(project: Project, id: string): Command[] {
    return [...project.elements.filter((element) => element.phaseIds.includes(id)).map((element): Command => ({ kind: 'element', id: element.id, value: { ...element, phaseIds: element.phaseIds.filter((phaseId) => phaseId !== id), version: element.version + 1 } })), { kind: 'phase', id, value: null }];
}
export function swapPhases(a: Phase, b: Phase): Command[] {
    return [{ kind: 'phase', id: a.id, value: { ...a, order: b.order } }, { kind: 'phase', id: b.id, value: { ...b, order: a.order } }];
}
