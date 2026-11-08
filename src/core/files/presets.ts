import { z } from 'zod';
import { FORMAT_VERSION, LIMITS, TeamSchema, type Team } from '../model/schema';
import { isJson, migrateEntity } from '../model/migrations';

/**
 * Team preset file. `formatVersion` is the container; the teams inside are plan entities in plan
 * format `projectFormatVersion` (absent = 1) and are migrated like live entities.
 */
const PRESET_FORMAT_VERSION = 1;
const PresetFileSchema = z.object({
    format: z.literal('as-tac-teams'),
    formatVersion: z.number().int().min(1),
    projectFormatVersion: z.number().int().min(1).optional(),
    teams: z.array(z.unknown()).max(LIMITS.teams),
});
const PresetTeamsSchema = z.array(TeamSchema).max(LIMITS.teams);

/** Teams of a preset file in the current plan format; `newer` when it comes from a newer app. */
export function presetTeams(data: unknown): { teams: z.infer<typeof PresetTeamsSchema> } | 'newer' | 'invalid' {
    const file = PresetFileSchema.safeParse(data);
    if (!file.success) {
        return 'invalid';
    }
    const from = file.data.projectFormatVersion ?? 1;
    if (file.data.formatVersion > PRESET_FORMAT_VERSION || from > FORMAT_VERSION) {
        return 'newer';
    }
    try {
        const teams = PresetTeamsSchema.safeParse(file.data.teams.map((team) => (isJson(team) ? migrateEntity('teams', team, from) : team)));
        return teams.success ? { teams: teams.data } : 'invalid';
    } catch {
        return 'invalid';
    }
}
/** The file written by «Teamvorlage exportieren». */
export function presetFile(teams: Team[]) {
    return { format: 'as-tac-teams', formatVersion: PRESET_FORMAT_VERSION, projectFormatVersion: FORMAT_VERSION, teams };
}
