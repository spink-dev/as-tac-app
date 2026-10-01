import { useState } from 'react';
import type { Map as LibreMap } from 'maplibre-gl';
import type { Phase, Project, Team } from '../../core/projects/model';
import type { Command } from '../../core/projects/commands';
import { removePhase, removeTeam, savePhase, swapPhases } from './commands';
import { de } from '../../i18n/de';
export function captureCamera(map: LibreMap | null): Phase['camera'] {
    if (!map) {
        return null;
    }
    const center = map.getCenter().wrap();
    return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
}
function TeamForm({ team, project, change }: { team: Team; project: Project; change: (commands: Command[]) => void }) {
    const t = de.briefing;
    const [name, setName] = useState(team.name);
    const [shortLabel, setShort] = useState(team.shortLabel);
    const [colour, setColour] = useState(team.colour);
    return <details><summary>{team.shortLabel} · {team.name}</summary><form aria-label={t.teamEdit(team.name)} onSubmit={(event) => {
        event.preventDefault();
        change([{ kind: 'team', id: team.id, value: { ...team, name: name.trim(), shortLabel: shortLabel.trim(), colour } }]);
    }}>
        <label>{t.teamName}<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>{t.shortLabel}<input required maxLength={12} value={shortLabel} onChange={(event) => setShort(event.target.value)} /></label>
        <label>{de.editor.colour}<input type="color" value={colour} onChange={(event) => setColour(event.target.value)} /></label>
        <div className="actions"><button type="submit">{de.editor.apply}</button><button type="button" onClick={() => change(removeTeam(project, team.id))}>{t.deleteTeam}</button></div>
    </form></details>;
}
function PhaseForm({ phase, project, map, change }: { phase: Phase; project: Project; map: LibreMap | null; change: (commands: Command[]) => void }) {
    const t = de.briefing;
    const [title, setTitle] = useState(phase.title);
    const [notes, setNotes] = useState(phase.notes);
    const [camera, setCamera] = useState(phase.camera);
    const [ids, setIds] = useState(phase.visibleElementIds);
    return <details><summary>{phase.title}</summary><form aria-label={t.phaseEdit(phase.title)} onSubmit={(event) => {
        event.preventDefault();
        change(savePhase(project, { ...phase, title: title.trim(), notes, camera, visibleElementIds: ids }));
    }}>
        <label>{t.phaseTitle}<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{t.phaseNotes}<textarea aria-label={t.phaseNotes} maxLength={10_000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <button type="button" disabled={!map} onClick={() => setCamera(captureCamera(map))}>{t.capture}</button>
        {camera && <p className="muted">{t.camera(camera.center, camera.zoom)}</p>}
        <fieldset><legend>{t.elements}</legend>{project.elements.filter((element) => !element.deletedAt).map((element) => <label className="check-label" key={element.id}>
            <input type="checkbox" checked={ids.includes(element.id)} onChange={(event) => setIds(event.target.checked ? [...ids, element.id] : ids.filter((id) => id !== element.id))} />{element.label || de.editor.tools[element.type]}
        </label>)}</fieldset>
        <div className="actions"><button type="submit">{de.editor.apply}</button><button type="button" onClick={() => change(removePhase(project, phase.id))}>{t.deletePhase}</button></div>
    </form></details>;
}
export default function ManagementPanel({ project, map, change, disabled }: { project: Project | null; map: LibreMap | null; change: (commands: Command[]) => void; disabled: boolean }) {
    const t = de.briefing;
    const [teamName, setTeamName] = useState('');
    const [phaseName, setPhaseName] = useState('');
    if (!project) {
        return null;
    }
    const phases = [...project.phases].sort((a, b) => a.order - b.order);
    return <section aria-label={t.manage}><h2>{t.manage}</h2><fieldset disabled={disabled} className="management-fields">
        <form onSubmit={(event) => {
            event.preventDefault();
            const name = teamName.trim();
            const id = crypto.randomUUID();
            change([{ kind: 'team', id, value: { id, name, shortLabel: name.slice(0, 12).toUpperCase(), colour: '#176b89' } }]);
            setTeamName('');
        }}>
            <label>{t.newTeam}<input required maxLength={120} value={teamName} onChange={(event) => setTeamName(event.target.value)} /></label>
            <button disabled={!teamName.trim() || project.teams.length >= 100}>{t.addTeam}</button>
        </form>
        {project.teams.map((team) => <TeamForm key={JSON.stringify(team)} team={team} project={project} change={change} />)}
        <form onSubmit={(event) => {
            event.preventDefault();
            const phase: Phase = { id: crypto.randomUUID(), order: Math.max(-1, ...phases.map((item) => item.order)) + 1,
                title: phaseName.trim(), notes: '', camera: captureCamera(map), visibleElementIds: project.elements.filter((element) => !element.deletedAt).map((element) => element.id) };
            change(savePhase(project, phase));
            setPhaseName('');
        }}>
            <label>{t.newPhase}<input required maxLength={120} value={phaseName} onChange={(event) => setPhaseName(event.target.value)} /></label>
            <button disabled={!phaseName.trim() || project.phases.length >= 100}>{t.addPhase}</button>
        </form>
        {phases.map((phase, index) => <div key={phase.id} className="phase-card">
            <PhaseForm key={JSON.stringify(phase)} phase={phase} project={project} map={map} change={change} />
            <div className="actions"><button aria-label={t.up(phase.title)} disabled={index === 0} onClick={() => change(swapPhases(phase, phases[index - 1]))}>↑</button>
                <button aria-label={t.down(phase.title)} disabled={index === phases.length - 1} onClick={() => change(swapPhases(phase, phases[index + 1]))}>↓</button></div>
        </div>)}
        <p className="muted">{t.undoHint}</p>
    </fieldset></section>;
}
