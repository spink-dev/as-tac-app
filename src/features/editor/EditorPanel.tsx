import { useState } from 'react';
import type { Coordinate, PlanElement, Project } from '../../core/projects/model';
import type { ProjectSession, ProjectState } from '../../core/projects/session';
import { de } from '../../i18n/de';
import { measurements, vertices, withVertices } from './geometry';
import type { Editor, Tool } from './useEditor';

function Inspector({ element, editor, project }: { element: PlanElement; editor: Editor; project: Project }) {
    const t = de.editor;
    const [label, setLabel] = useState(element.label);
    const [notes, setNotes] = useState(element.notes);
    const [teamId, setTeamId] = useState(element.teamId ?? '');
    const [phaseIds, setPhaseIds] = useState(element.phaseIds);
    const [colour, setColour] = useState(element.style.colour);
    const [width, setWidth] = useState(String(element.style.width));
    const [radius, setRadius] = useState(element.geometry.type === 'Circle' ? String(element.geometry.radiusMeters) : '');
    const [coordinates, setCoordinates] = useState(vertices(element.geometry).map((point) => point.join(', ')).join('\n'));
    const [invalid, setInvalid] = useState(false);
    const metric = measurements(element.geometry);
    return <div className="inspector">
        <h3>{t.details}</h3>
        <p>{t.tools[element.type]} · {t.measure(metric.length, metric.area)}</p>
        {!editor.editing ? <><p>{element.label}</p><p className="notes">{element.notes}</p></> : <form onSubmit={(event) => {
            event.preventDefault();
            const points = coordinates.trim().split('\n').map((line) => line.split(',').map((part) => part.trim() === '' ? NaN : Number(part))) as Coordinate[];
            const minimum = element.geometry.type === 'Polygon' ? 3 : element.geometry.type === 'LineString' ? 2 : 1;
            if (points.length < minimum || (minimum === 1 && points.length !== 1) || points.length > 5_000 || points.some((point) => point.length !== 2 || !point.every(Number.isFinite))) {
                setInvalid(true);
                return;
            }
            let geometry = withVertices(element.geometry, points);
            if (geometry.type === 'Circle') {
                geometry = { ...geometry, radiusMeters: Number(radius) };
            }
            const success = editor.commit({ ...element, label, notes, teamId: teamId || undefined, phaseIds, geometry, style: { ...element.style, colour, width: Number(width) }, version: element.version + 1 });
            setInvalid(!success);
        }}>
            <label>{t.label}<input maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
            <label>{t.notes}<textarea aria-label={t.notes} maxLength={10_000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <label>{de.briefing.assignment}<select aria-label={de.briefing.assignment} value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                <option value="">{de.briefing.noTeam}</option>{project.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select></label>
            {project.phases.length > 0 && <fieldset><legend>{de.briefing.phaseAssignment}</legend>{project.phases.map((phase) => <label className="check-label" key={phase.id}>
                <input type="checkbox" checked={phaseIds.includes(phase.id)} onChange={(event) => setPhaseIds(event.target.checked ? [...phaseIds, phase.id] : phaseIds.filter((id) => id !== phase.id))} />{phase.title}
            </label>)}</fieldset>}
            <div className="coordinate-grid">
                <label>{t.colour}<input type="color" value={colour} onChange={(event) => setColour(event.target.value)} /></label>
                <label>{t.width}<input type="number" min="1" max="20" step="1" value={width} onChange={(event) => setWidth(event.target.value)} /></label>
            </div>
            <label>{t.coordinates}<textarea aria-label={t.coordinates} rows={Math.min(8, Math.max(2, vertices(element.geometry).length))} value={coordinates} onChange={(event) => setCoordinates(event.target.value)} /></label>
            <p className="muted">{t.coordinateHint}</p>
            {element.geometry.type === 'Circle' && <label>{t.radius}<input type="number" min="0.1" max="100000" step="any" value={radius} onChange={(event) => setRadius(event.target.value)} /></label>}
            {vertices(element.geometry).length > 200 && <p className="muted">{t.handlesLimit}</p>}
            {invalid && <p role="alert">{t.invalid}</p>}
            <div className="actions"><button type="submit">{t.apply}</button><button type="button" onClick={editor.remove}>{t.delete}</button></div>
        </form>}
    </div>;
}
export default function EditorPanel({ editor, project, session, state, disabled, statusText }: {
    editor: Editor; project: Project | null; session: Pick<ProjectSession, 'undo' | 'redo'>; state: Pick<ProjectState, 'saveState' | 'canUndo' | 'canRedo'>; disabled: boolean; statusText?: string;
}) {
    const t = de.editor;
    const [query, setQuery] = useState('');
    if (!project) {
        return null;
    }
    const elements = project.elements.filter((element) => !element.deletedAt && `${element.label} ${element.notes}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return <section aria-label={t.title}>
        <h2>{t.title}</h2>
        <p role="status">{statusText ?? t.saveStates[state.saveState]}</p>
        <button disabled={disabled || editor.hasDraft} aria-pressed={editor.editing} onClick={() => {
            editor.cancel();
            editor.setEditing(!editor.editing);
        }}>{editor.editing ? t.field : t.edit}</button>
        <p className="muted">{editor.editing ? t.editHint : t.fieldHint}</p>
        <label className="check-label"><input type="checkbox" checked={editor.visible} disabled={editor.hasDraft} onChange={(event) => editor.setVisible(event.target.checked)} />{t.visible}</label>
        {editor.editing && <>
            <div className="actions" role="group" aria-label={t.toolsLabel}>
                {(Object.keys(t.tools) as Tool[]).map((tool) => <button key={tool} disabled={disabled || (editor.hasDraft && tool !== editor.tool)} aria-pressed={editor.tool === tool} onClick={() => editor.choose(tool)}>{t.tools[tool]}</button>)}
            </div>
            {editor.tool !== 'select' && <p role="status">{t.instructions[editor.tool]}</p>}
            <div className="actions">
                {['line', 'polygon', 'freehand'].includes(editor.tool) && <button disabled={!editor.hasDraft} onClick={() => editor.finish()}>{t.finish}</button>}
                {editor.tool !== 'select' && <button onClick={editor.cancel}>{t.cancel}</button>}
                <button disabled={disabled || editor.hasDraft || !state.canUndo} onClick={session.undo}>{t.undo}</button>
                <button disabled={disabled || editor.hasDraft || !state.canRedo} onClick={session.redo}>{t.redo}</button>
            </div>
        </>}
        {editor.error && <p role="alert">{editor.error}</p>}
        <label>{t.search}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <ul className="element-list">{elements.map((element) => <li key={element.id}><button disabled={editor.hasDraft} aria-pressed={editor.selected?.id === element.id} onClick={() => editor.select(element)}>{element.label || t.tools[element.type]} <small>· {t.tools[element.type]}</small></button></li>)}</ul>
        {!elements.length && <p>{t.empty}</p>}
        {editor.selected && !editor.hasDraft && <fieldset disabled={disabled}><Inspector key={`${editor.selected.id}:${editor.selected.version}:${editor.editing}`} element={editor.selected} editor={editor} project={project} /></fieldset>}
    </section>;
}
