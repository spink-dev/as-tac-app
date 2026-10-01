import { useState } from 'react';
import { workspaceOf, type Project, type PlanLayer } from '../../core/projects/model';
import type { Editor } from './useEditor';

export default function LayerPanel({ editor, project, disabled }: { editor: Editor; project: Project; disabled: boolean }) {
    const [name, setName] = useState('');
    const workspace = workspaceOf(project);
    const layers = workspace.layers;
    const update = (next: PlanLayer[]) => editor.changeLayers({ ...workspace, layers: next });
    return (
        <details className="layer-panel">
            <summary>
                Ebenen <span>{layers.length + 1}</span>
            </summary>
            <p className="muted">
                Unten liegende Ebenen werden darüber gezeichnet. Flächen bleiben durchsichtig. Sichtbarkeit gilt nur für deine Ansicht.
            </p>
            {[{ id: '', name: 'Markierungen', opacity: 1, locked: false }, ...layers].map((layer, index) => (
                <div className="layer-row" key={layer.id}>
                    <label className="check-label">
                        <input
                            type="checkbox"
                            disabled={editor.hasDraft}
                            checked={!editor.hiddenLayers.includes(layer.id)}
                            onChange={(event) =>
                                editor.setHiddenLayers(
                                    event.target.checked
                                        ? editor.hiddenLayers.filter((id) => id !== layer.id)
                                        : [...editor.hiddenLayers, layer.id],
                                )
                            }
                        />
                        {layer.name}
                    </label>
                    {editor.editing && (
                        <button
                            disabled={disabled || layer.locked || editor.hiddenLayers.includes(layer.id)}
                            aria-pressed={editor.activeLayer === layer.id}
                            onClick={() => editor.setActiveLayer(layer.id)}
                        >
                            Hier zeichnen
                        </button>
                    )}
                    {layer.id && (
                        <>
                            <label>
                                Deckkraft {Math.round((editor.viewOpacity[layer.id] ?? layer.opacity) * 100)} %
                                <input
                                    aria-label={`Deckkraft ${layer.name}`}
                                    type="range"
                                    min="0.1"
                                    max="1"
                                    step="0.05"
                                    disabled={editor.hasDraft || editor.hasUnsavedForm}
                                    value={editor.viewOpacity[layer.id] ?? layer.opacity}
                                    onChange={(event) => {
                                        const opacity = Number(event.target.value);
                                        if (editor.editing && !disabled) {
                                            update(layers.map((item) => (item.id === layer.id ? { ...item, opacity } : item)));
                                            const next = { ...editor.viewOpacity };
                                            delete next[layer.id];
                                            editor.setViewOpacity(next);
                                        } else {
                                            editor.setViewOpacity({ ...editor.viewOpacity, [layer.id]: opacity });
                                        }
                                    }}
                                />
                            </label>
                            {editor.editing && (
                                <div className="actions">
                                    <button
                                        disabled={disabled}
                                        aria-pressed={layer.locked}
                                        onClick={() =>
                                            update(layers.map((item) => (item.id === layer.id ? { ...item, locked: !item.locked } : item)))
                                        }
                                    >
                                        {layer.locked ? 'Entsperren' : 'Sperren'} {layer.name}
                                    </button>
                                    <button
                                        disabled={disabled || index === layers.length}
                                        onClick={() => {
                                            const next = [...layers];
                                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                            update(next);
                                        }}
                                    >
                                        Über nächste Ebene
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            ))}
            {editor.editing && (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!name.trim()) {
                            return;
                        }
                        const id = crypto.randomUUID();
                        update([...layers, { id, name: name.trim(), opacity: 1, locked: false }]);
                        editor.setActiveLayer(id);
                        setName('');
                    }}
                >
                    <label>
                        Neue Ebene
                        <input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
                    </label>
                    <button disabled={disabled || layers.length >= 32 || !name.trim()}>Ebene hinzufügen</button>
                </form>
            )}
        </details>
    );
}
