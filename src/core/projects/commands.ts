import { validateProject, type Project, type PlanElement, type Phase, type Team } from './model';

export type Command =
    | { kind: 'project'; name?: string; mapPackageId?: string }
    | { kind: 'element'; id: string; index?: number; value: PlanElement | null }
    | { kind: 'team'; id: string; index?: number; value: Team | null }
    | { kind: 'phase'; id: string; index?: number; value: Phase | null };
export interface Change {
    forward: Command[];
    inverse: Command[];
}
/** A batch is one atomic user action; validate references only after all its changes. */
export function execute(project: Project, commands: Command[]): { project: Project; change: Change } {
    const next = structuredClone(project);
    const inverse: Command[] = [];
    for (const command of commands) {
        if (command.kind === 'project') {
            inverse.unshift({ kind: 'project', name: next.name, mapPackageId: next.mapPackageId });
            if (command.name !== undefined) {
                next.name = command.name;
            }
            if (command.mapPackageId !== undefined) {
                next.mapPackageId = command.mapPackageId;
            }
        } else {
            const key = { element: 'elements', team: 'teams', phase: 'phases' }[command.kind] as 'elements' | 'teams' | 'phases';
            const list = next[key] as (PlanElement | Team | Phase)[];
            const index = list.findIndex((item) => item.id === command.id);
            inverse.unshift({ kind: command.kind, id: command.id, index: index < 0 ? undefined : index, value: index < 0 ? null : structuredClone(list[index]) } as Command);
            if (command.value !== null) {
                if (command.value.id !== command.id) {
                    throw new Error('Command ID mismatch');
                }
                if (index < 0) {
                    list.splice(command.index ?? list.length, 0, structuredClone(command.value));
                } else {
                    list[index] = structuredClone(command.value);
                }
            } else if (index >= 0) {
                list.splice(index, 1);
            }
        }
    }
    validateProject(next);
    return { project: next, change: { forward: structuredClone(commands), inverse } };
}
