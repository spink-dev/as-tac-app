import { symbols, patterns, labelModes } from './presentation';
import LayerPanel from './LayerPanel';
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
    const [symbol, setSymbol] = useState(element.style.symbol ?? 'auto');
    const [pattern, setPattern] = useState(element.style.pattern ?? 'auto');
    const [labelMode, setLabelMode] = useState(element.style.labelMode ?? 'auto');
    const [colour, setColour] = useState(element.style.colour);
    const [opacity, setOpacity] = useState(element.style.opacity);
    const [layerId, setLayerId] = useState(element.layerId ?? '');
    const [width, setWidth] = useState(String(element.style.width));
    const [radius, setRadius] = useState(element.geometry.type === 'Circle' ? String(element.geometry.radiusMeters) : '');
    const [coordinates, setCoordinates] = useState(
        vertices(element.geometry)
            .map((point) => point.join(', '))
            .join('\n'),
    );
    const [invalid, setInvalid] = useState(false);
    const metric = measurements(element.geometry);
    return (
        <div className="inspector">
            <h3>{t.details}</h3>
            <p>
                {t.tools[element.type]} · {t.measure(metric.length, metric.area)}
            </p>
            {!editor.editing ? (
                <>
                    <p>{element.label}</p>
                    <p className="notes">{element.notes}</p>
                </>
            ) : (
                <form
                    onChangeCapture={() => editor.setFormDirty(true)}
                    onSubmit={(event) => {
                        event.preventDefault();
                        const points = coordinates
                            .trim()
                            .split('\n')
                            .map((line) => line.split(',').map((part) => (part.trim() === '' ? NaN : Number(part)))) as Coordinate[];
                        const minimum = element.geometry.type === 'Polygon' ? 3 : element.geometry.type === 'LineString' ? 2 : 1;
                        if (
                            points.length < minimum ||
                            (minimum === 1 && points.length !== 1) ||
                            points.length > 5_000 ||
                            points.some((point) => point.length !== 2 || !point.every(Number.isFinite))
                        ) {
                            setInvalid(true);
                            return;
                        }
                        let geometry = withVertices(element.geometry, points);
                        if (geometry.type === 'Circle') {
                            geometry = { ...geometry, radiusMeters: Number(radius) };
                        }
                        const success = editor.commit({
                            ...element,
                            label,
                            notes,
                            ...(project.schemaVersion === 2 ? { layerId: layerId || undefined } : {}),
                            teamId: teamId || undefined,
                            phaseIds,
                            geometry,
                            style: { ...element.style, colour, opacity, width: Number(width), symbol, pattern, labelMode },
                            version: element.version + 1,
                        });
                        setInvalid(!success);
                    }}
                >
                    <label>
                        {t.label}
                        <input maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} />
                    </label>
                    <label>
                        {t.notes}
                        <textarea
                            aria-label={t.notes}
                            maxLength={10_000}
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                        />
                    </label>
                    <label>
                        {de.briefing.assignment}
                        <select aria-label={de.briefing.assignment} value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                            <option value="">{de.briefing.noTeam}</option>
                            {project.teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                    {team.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {project.phases.length > 0 && (
                        <fieldset>
                            <legend>{de.briefing.phaseAssignment}</legend>
                            {project.phases.map((phase) => (
                                <label className="check-label" key={phase.id}>
                                    <input
                                        type="checkbox"
                                        checked={phaseIds.includes(phase.id)}
                                        onChange={(event) =>
                                            setPhaseIds(
                                                event.target.checked ? [...phaseIds, phase.id] : phaseIds.filter((id) => id !== phase.id),
                                            )
                                        }
                                    />
                                    {phase.title}
                                </label>
                            ))}
                        </fieldset>
                    )}
                    <label>
                        Ebene
                        <select value={layerId} onChange={(event) => setLayerId(event.target.value)}>
                            <option value="">Markierungen</option>
                            {project.workspace?.layers.map((layer) => (
                                <option key={layer.id} value={layer.id} disabled={layer.locked}>
                                    {layer.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Deckkraft {Math.round(opacity * 100)} %
                        <input
                            type="range"
                            min="0.1"
                            max="1"
                            step="0.05"
                            value={opacity}
                            onChange={(event) => setOpacity(Number(event.target.value))}
                        />
                    </label>
                    <label>
                        Symbol
                        <select aria-label="Symbol" value={symbol} onChange={(event) => setSymbol(event.target.value as typeof symbol)}>
                            {Object.entries(symbols).map(([value, name]) => (
                                <option key={value} value={value}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label>
                        Beschriftung anzeigen
                        <select value={labelMode} onChange={(event) => setLabelMode(event.target.value as typeof labelMode)}>
                            {Object.entries(labelModes).map(([value, name]) => (
                                <option key={value} value={value}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {['Polygon', 'Circle'].includes(element.geometry.type) && (
                        <label>
                            Flächenmuster
                            <select value={pattern} onChange={(event) => setPattern(event.target.value as typeof pattern)}>
                                {Object.entries(patterns).map(([value, name]) => (
                                    <option key={value} value={value}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <div className="coordinate-grid">
                        <label>
                            {t.colour}
                            <input type="color" value={colour} onChange={(event) => setColour(event.target.value)} />
                        </label>
                        <label>
                            {t.width}
                            <input
                                type="number"
                                min="1"
                                max="20"
                                step="1"
                                value={width}
                                onChange={(event) => setWidth(event.target.value)}
                            />
                        </label>
                    </div>
                    <label>
                        {t.coordinates}
                        <textarea
                            aria-label={t.coordinates}
                            rows={Math.min(8, Math.max(2, vertices(element.geometry).length))}
                            value={coordinates}
                            onChange={(event) => setCoordinates(event.target.value)}
                        />
                    </label>
                    <p className="muted">{t.coordinateHint}</p>
                    {element.geometry.type === 'Circle' && (
                        <label>
                            {t.radius}
                            <input
                                type="number"
                                min="0.1"
                                max="100000"
                                step="any"
                                value={radius}
                                onChange={(event) => setRadius(event.target.value)}
                            />
                        </label>
                    )}
                    {vertices(element.geometry).length > 200 && <p className="muted">{t.handlesLimit}</p>}
                    {invalid && <p role="alert">{t.invalid}</p>}
                    <div className="actions">
                        <button type="submit">{t.apply}</button>
                        <button type="button" onClick={editor.cancel}>
                            Angaben verwerfen
                        </button>
                        <button type="button" onClick={editor.remove}>
                            {t.delete}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
export default function EditorPanel({
    editor,
    project,
    session,
    state,
    disabled,
    statusText,
}: {
    editor: Editor;
    project: Project | null;
    session: Pick<ProjectSession, 'undo' | 'redo'>;
    state: Pick<ProjectState, 'saveState' | 'canUndo' | 'canRedo'>;
    disabled: boolean;
    statusText?: string;
}) {
    const t = de.editor;
    const [query, setQuery] = useState('');
    if (!project) {
        return null;
    }
    const elements = project.elements.filter(
        (element) => !element.deletedAt && `${element.label} ${element.notes}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    return (
        <section aria-label={t.title}>
            <h2>{t.title}</h2>
            <p role="status">{statusText ?? t.saveStates[state.saveState]}</p>

            <p className="muted">{editor.editing ? t.editHint : t.fieldHint}</p>
            <label className="check-label">
                <input
                    type="checkbox"
                    checked={editor.visible}
                    disabled={editor.hasDraft}
                    onChange={(event) => editor.setVisible(event.target.checked)}
                />
                {t.visible}
            </label>
            {editor.editing && (
                <>
                    <details>
                        <summary>Tastenkürzel</summary>
                        <p>
                            V Auswahl · P Punkt · L Linie · A Fläche · C Kreis · T Text · F Freihand. Enter abschliessen, Rücktaste letzten
                            Eckpunkt entfernen, Escape abbrechen. Beim Schreiben in Feldern bleiben die Tasten normale Texteingaben.
                        </p>
                    </details>
                    <div className="actions" role="group" aria-label={t.toolsLabel}>
                        {(Object.keys(t.tools) as Tool[]).map((tool) => (
                            <button
                                data-draw-tool={tool === 'select' ? undefined : tool}
                                key={tool}
                                disabled={disabled || editor.hasUnsavedForm || (editor.hasDraft && tool !== editor.tool)}
                                aria-pressed={editor.tool === tool}
                                onClick={() => editor.choose(tool)}
                            >
                                {t.tools[tool]}
                            </button>
                        ))}
                    </div>
                    {editor.tool !== 'select' && <p role="status">{t.instructions[editor.tool]}</p>}
                    <div className="actions">
                        {['line', 'polygon', 'freehand'].includes(editor.tool) && (
                            <button disabled={!editor.hasDraft} onClick={() => editor.finish()}>
                                {t.finish}
                            </button>
                        )}
                        {editor.tool !== 'select' && <button onClick={editor.cancel}>{t.cancel}</button>}
                        <button disabled={disabled || editor.hasDraft || !state.canUndo} onClick={session.undo}>
                            {t.undo}
                        </button>
                        <button disabled={disabled || editor.hasDraft || !state.canRedo} onClick={session.redo}>
                            {t.redo}
                        </button>
                    </div>
                </>
            )}
            {editor.selected && !editor.hasDraft && (
                <fieldset disabled={disabled || !editor.canEdit(editor.selected)}>
                    <Inspector
                        key={`${editor.selected.id}:${editor.selected.version}:${editor.editing}:${editor.formEpoch}`}
                        element={editor.selected}
                        editor={editor}
                        project={project}
                    />
                </fieldset>
            )}
            <LayerPanel editor={editor} project={project} disabled={disabled || editor.hasDraft || editor.hasUnsavedForm} />
            {editor.overlaps.length > 1 && (
                <fieldset>
                    <legend>Überlagerte Objekte</legend>
                    {editor.overlaps.map((id) => (
                        <button
                            key={id}
                            disabled={editor.hasUnsavedForm}
                            aria-pressed={editor.selected?.id === id}
                            onClick={() => editor.setSelectedId(id)}
                        >
                            {project.elements.find((element) => element.id === id)?.label || 'Markierung'}
                        </button>
                    ))}
                </fieldset>
            )}
            {editor.error && <p role="alert">{editor.error}</p>}
            <label>
                {t.search}
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <ul className="element-list">
                {elements.map((element) => (
                    <li key={element.id}>
                        <button
                            disabled={editor.hasDraft || editor.hasUnsavedForm}
                            aria-pressed={editor.selected?.id === element.id}
                            onClick={() => editor.select(element)}
                        >
                            {element.label || t.tools[element.type]} <small>· {t.tools[element.type]}</small>
                        </button>
                    </li>
                ))}
            </ul>
            {!elements.length && <p>{t.empty}</p>}
        </section>
    );
}
