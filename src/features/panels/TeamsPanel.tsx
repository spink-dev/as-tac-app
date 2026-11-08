import { useState } from 'react';
import { ChevronDown, Download, ImagePlus, MapPin, Plus, Trash2, Upload } from 'lucide-react';
import { useT } from '../../i18n';
import { useProject, mutate } from '../../core/store/project';
import { useUi, toast } from '../../core/store/ui';
import { Button, Empty, Field, IconButton, NameInput, Segmented, Swatches, Switch } from '../../ui/components';
import { createTeam, uid, TEAM_COLORS } from '../../core/model/factory';
import { canEdit, addElement, toastUndoable } from '../../core/actions';
import { LIMITS, MAX, TeamSchema, type Team } from '../../core/model/schema';
import { UNIT_SYMBOLS } from '../../map/icons';
import { getAsset, isRenderableImage, putAsset, prepareImage } from '../../core/storage/assets';
import { pickFile, saveFile } from '../../core/files/save';
import { mapCenter } from '../../map/interaction';
import { z } from 'zod';

const PLANNING: (keyof NonNullable<Team['planning']>)[] = ['role', 'mission', 'task', 'objective', 'startPoint', 'rallyPoint', 'timing', 'actionsOnContact', 'contingency', 'equipment'];
const LONG = new Set(['mission', 'task', 'actionsOnContact', 'contingency', 'equipment']);

const PresetSchema = z.object({ format: z.literal('as-tac-teams'), formatVersion: z.literal(1), teams: z.array(TeamSchema).max(LIMITS.teams) });
const PRESET_MAX_BYTES = 1024 * 1024;

/** Team presets are untrusted files: size limit, JSON + schema check, count cap, dangling logos dropped. */
async function importPreset(t: ReturnType<typeof useT>) {
    const file = await pickFile('application/json,.json');
    const project = useProject.getState().project;
    if (!file || !project || !canEdit()) {
        return;
    }
    if (file.size > PRESET_MAX_BYTES) {
        toast(t('teams.importTooLarge'), { tone: 'danger' });
        return;
    }
    let data: unknown;
    try {
        data = JSON.parse(await file.text());
    } catch {
        toast(t('teams.importInvalid'), { tone: 'danger' });
        return;
    }
    const parsed = PresetSchema.safeParse(data);
    if (!parsed.success) {
        toast(t('teams.importInvalid'), { tone: 'danger' });
        return;
    }
    if (project.teams.length + parsed.data.teams.length > LIMITS.teams) {
        toast(t('teams.limit', { n: LIMITS.teams }), { tone: 'warn' });
        return;
    }
    // Fresh ids; formation ids are remapped consistently so squads stay linked.
    const formations = new Map<string, string>();
    let missingLogos = 0;
    const teams: Team[] = [];
    for (const team of parsed.data.teams) {
        const next: Team = { ...team, id: uid('team') };
        if (team.formationId) {
            if (!formations.has(team.formationId)) {
                formations.set(team.formationId, uid('fm'));
            }
            next.formationId = formations.get(team.formationId);
        }
        if (team.logoAsset && !(await getAsset(team.logoAsset))) {
            missingLogos += 1;
            delete next.logoAsset;
            next.displayMode = 'icon';
        }
        teams.push(next);
    }
    const ok = mutate(t('teams.importPreset'), (draft) => {
        draft.teams.push(...teams);
    });
    if (ok) {
        toast(t('teams.imported', { n: teams.length }));
        if (missingLogos > 0) {
            toast(t('teams.logoMissing', { n: missingLogos }), { tone: 'warn' });
        }
    }
}

function deleteTeam(team: Team, t: ReturnType<typeof useT>) {
    const project = useProject.getState().project;
    if (!project || !canEdit()) {
        return;
    }
    const assigned = project.elements.filter((e) => e.teamId === team.id).length;
    const ok = mutate(t('common.delete'), (draft) => {
        draft.teams = draft.teams.filter((x) => x.id !== team.id);
        for (const element of draft.elements) {
            if (element.teamId === team.id) {
                delete element.teamId;
            }
        }
        for (const entry of draft.log) {
            if (entry.teamId === team.id) {
                delete entry.teamId;
            }
        }
    });
    if (!ok) {
        return;
    }
    const ui = useUi.getState();
    if (ui.activeTeamId === team.id) {
        ui.set({ activeTeamId: null });
    }
    if (ui.draft?.teamId === team.id) {
        ui.set({ draft: { ...ui.draft, teamId: undefined } });
    }
    toastUndoable(t('teams.deleted', { name: team.name, n: assigned }));
}

function TeamEditor({ team }: { team: Team }) {
    const t = useT();
    const project = useProject((state) => state.project);
    useProject((state) => state.readOnly);
    useUi((state) => state.mode);
    const editable = canEdit();
    const [planning, setPlanning] = useState(false);
    if (!project) {
        return null;
    }
    const patch = (value: Partial<Team>, field: string) => mutate(t('common.edit'), (draft) => {
        const target = draft.teams.find((x) => x.id === team.id);
        if (target) {
            Object.assign(target, value);
            for (const [k, v] of Object.entries(value)) {
                if (v === undefined) {
                    delete (target as Record<string, unknown>)[k];
                }
            }
        }
    }, { key: `team:${team.id}:${field}` });
    const formations = [...new Set(project.teams.filter((x) => x.formationId && x.id !== team.id).map((x) => `${x.formationId}|${x.formationName ?? ''}`))];

    return (
        <div className="stack team-editor">
        <fieldset className="plain stack" disabled={!editable}>
            <div className="field-row">
                <Field label={t('common.name')}>
                    <NameInput maxLength={MAX.name} value={team.name} onCommit={(name) => patch({ name }, 'name')} />
                </Field>
                <Field label={t('teams.callsign')}>
                    <input className="input" maxLength={MAX.callsign} value={team.callsign ?? ''} onChange={(event) => patch({ callsign: event.target.value || undefined }, 'callsign')} />
                </Field>
            </div>
            <div className="field-row">
                <Field label={t('teams.unit')} hint="z. B. 2-1">
                    <input className="input" maxLength={MAX.unitNumber} value={team.unitNumber ?? ''} onChange={(event) => patch({ unitNumber: event.target.value || undefined }, 'unit')} />
                </Field>
                <Field label={t('teams.radio')}>
                    <input className="input" maxLength={MAX.radio} value={team.radioChannel ?? ''} onChange={(event) => patch({ radioChannel: event.target.value || undefined }, 'radio')} />
                </Field>
            </div>
            <Field label={t('teams.side')}>
                <Segmented block value={team.side ?? 'friendly'} onChange={(side) => patch({ side }, 'side')} options={[
                    { value: 'friendly', label: t('teams.side.friendly') }, { value: 'enemy', label: t('teams.side.enemy') }, { value: 'neutral', label: t('teams.side.neutral') },
                ]} />
            </Field>
            <Field label={t('common.color')}>
                <Swatches value={team.color} colors={TEAM_COLORS} onChange={(color) => patch({ color }, 'color')} />
            </Field>
            <Field label={t('teams.symbol')}>
                <Segmented value={team.displayMode ?? 'icon'} onChange={(displayMode) => patch({ displayMode }, 'display')} options={[{ value: 'icon', label: t('teams.symbol') }, { value: 'logo', label: t('teams.logo') }]} />
                {team.displayMode === 'logo' ? (
                    <Button small onClick={async () => {
                        const file = await pickFile('image/png,image/jpeg,image/webp');
                        if (!file) {
                            return;
                        }
                        try {
                            const prepared = await prepareImage(file);
                            const asset = await putAsset(prepared.blob, file.name, { width: prepared.width, height: prepared.height });
                            if (!isRenderableImage(asset)) {
                                throw new Error('image-format');
                            }
                            patch({ logoAsset: asset.hash }, 'logo');
                        } catch (error) {
                            const message = error instanceof Error ? error.message : '';
                            toast(message === 'asset-too-large' || message === 'image-too-large' ? t('maps.tooLarge') : t('maps.imageFailed'), { tone: 'warn' });
                        }
                    }}><ImagePlus size={16} /> {t('teams.logoUpload')}</Button>
                ) : (
                    <div className="chip-row">
                        {UNIT_SYMBOLS.map((symbol) => (
                            <button key={symbol} type="button" className="chip" aria-pressed={team.symbol === symbol} onClick={() => patch({ symbol }, 'symbol')}>{symbol}</button>
                        ))}
                        <input className="input input--short" placeholder="AB" maxLength={2} aria-label="Initialen" value={team.symbol?.startsWith('text:') ? team.symbol.slice(5) : ''} onChange={(event) => patch({ symbol: event.target.value ? `text:${event.target.value}` : 'infantry' }, 'symbol')} />
                    </div>
                )}
            </Field>
            <Field label={t('teams.formation')}>
                <select className="select" value={team.formationId ? `${team.formationId}|${team.formationName ?? ''}` : ''} onChange={(event) => {
                    if (event.target.value === '__new') {
                        patch({ formationId: uid('fm'), formationName: team.name }, 'formation');
                    } else if (!event.target.value) {
                        patch({ formationId: undefined, formationName: undefined, inheritFormationVisual: undefined }, 'formation');
                    } else {
                        const [formationId, formationName] = event.target.value.split('|');
                        patch({ formationId, formationName: formationName || undefined }, 'formation');
                    }
                }}>
                    <option value="">{t('common.none')}</option>
                    {team.formationId && !formations.includes(`${team.formationId}|${team.formationName ?? ''}`) ? <option value={`${team.formationId}|${team.formationName ?? ''}`}>{team.formationName ?? team.name}</option> : null}
                    {formations.map((f) => <option key={f} value={f}>{f.split('|')[1] || f.split('|')[0]}</option>)}
                    <option value="__new">+ {t('teams.formation')}</option>
                </select>
            </Field>
            {team.formationId ? (
                <Switch checked={Boolean(team.inheritFormationVisual)} onChange={(value) => patch({ inheritFormationVisual: value || undefined }, 'inherit')}>{t('teams.shareVisual')}</Switch>
            ) : null}
        </fieldset>
            {/* Outside the fieldset: the mission card stays readable in field mode and for viewers. */}
            <button type="button" className="disclosure" aria-expanded={planning} onClick={() => setPlanning(!planning)}>
                <ChevronDown size={16} className={planning ? 'rot-180' : ''} /> {t('teams.missionCard')}
            </button>
            {planning ? (
                <fieldset className="plain stack" disabled={!editable}>
            {PLANNING.map((field) => (
                <Field key={field} label={t(`teams.${field}`)}>
                    {LONG.has(field) ? (
                        <textarea className="textarea" rows={2} maxLength={MAX.longText} value={team.planning?.[field] ?? ''} onChange={(event) => patch({ planning: { ...team.planning, [field]: event.target.value || undefined } }, `plan:${field}`)} />
                    ) : (
                        <input className="input" maxLength={MAX.shortText} value={team.planning?.[field] ?? ''} onChange={(event) => patch({ planning: { ...team.planning, [field]: event.target.value || undefined } }, `plan:${field}`)} />
                    )}
                </Field>
            ))}
                </fieldset>
            ) : null}
            {editable ? (
            <div className="row-gap">
                <Button small onClick={() => {
                    const center = mapCenter();
                    if (!center) {
                        return;
                    }
                    const id = addElement({ kind: 'marker', id: uid('el'), pos: center, type: team.side === 'enemy' ? 'enemy' : 'unit', teamId: team.id, label: team.callsign }, t('teams.place'));
                    useUi.getState().select([id]);
                }}><MapPin size={16} /> {t('teams.place')}</Button>
                <span className="spacer" />
                <IconButton label={t('common.delete')} onClick={() => deleteTeam(team, t)}><Trash2 size={18} /></IconButton>
            </div>
            ) : null}
        </div>
    );
}

export function TeamsPanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    useProject((state) => state.readOnly);
    useUi((state) => state.mode);
    const [open, setOpen] = useState<string | null>(null);
    if (!project) {
        return null;
    }
    const editable = canEdit();
    const full = project.teams.length >= LIMITS.teams;
    const add = () => {
        const team = createTeam(project.teams.length);
        if (!mutate(t('teams.add'), (draft) => {
            draft.teams.push(team);
        })) {
            return;
        }
        setOpen(team.id);
        useUi.getState().set({ activeTeamId: team.id });
    };
    return (
        <div className="stack">
            <div className="row-gap">
                {editable ? <Button small variant="primary" onClick={add} disabled={full} title={full ? t('teams.limit', { n: LIMITS.teams }) : undefined}><Plus size={16} /> {t('teams.add')}</Button> : null}
                <span className="spacer" />
                <IconButton small label={t('teams.exportPreset')} onClick={() => saveFile(new Blob([JSON.stringify({ format: 'as-tac-teams', formatVersion: 1, teams: project.teams })], { type: 'application/json' }), `${project.name}.teams.json`)}><Download size={16} /></IconButton>
                {editable ? (
                    <IconButton small label={t('teams.importPreset')} disabled={full} onClick={() => void importPreset(t)}><Upload size={16} /></IconButton>
                ) : null}
            </div>
            {project.teams.length === 0 ? <Empty>{t('teams.empty')}</Empty> : null}
            <ul className="team-list">
                {project.teams.map((team) => (
                    <li key={team.id} className="team-row">
                        <button type="button" className="list-row" aria-expanded={open === team.id} onClick={() => {
                            setOpen(open === team.id ? null : team.id);
                            useUi.getState().set({ activeTeamId: team.id });
                        }}>
                            <span className="dot" style={{ ['--dot' as string]: team.color }} />
                            <span className="list-row__main">
                                <span className="list-row__title">{team.unitNumber ? `${team.unitNumber} · ` : ''}{team.name}</span>
                                <span className="list-row__meta">{[team.callsign, team.formationName, team.radioChannel ? `CH ${team.radioChannel}` : ''].filter(Boolean).join(' · ') || t(`teams.side.${team.side ?? 'friendly'}`)}</span>
                            </span>
                            <ChevronDown size={16} className={open === team.id ? 'rot-180' : ''} />
                        </button>
                        {open === team.id ? <TeamEditor team={team} /> : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}
