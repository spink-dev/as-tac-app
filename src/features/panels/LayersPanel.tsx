import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { useProject, mutate } from '../../core/store/project';
import { useUi, toast } from '../../core/store/ui';
import { Button, ICON, IconButton, NameInput, Segmented, Switch } from '../../ui/components';
import { createLayer } from '../../core/model/factory';
import { activeLayerId, canEdit, toastUndoable } from '../../core/actions';
import { LIMITS, MAX } from '../../core/model/schema';

export function LayersPanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    // Subscriptions so permission changes (mode, live role) re-render the controls.
    useProject((state) => state.readOnly);
    useUi((state) => state.mode);
    useUi((state) => state.activeLayerId);
    if (!project) {
        return null;
    }
    const editable = canEdit();
    const active = activeLayerId(project);
    const counts = new Map<string, number>();
    for (const element of project.elements) {
        const id = element.layerId ?? project.layers[0].id;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const patchLayer = (id: string, patch: Record<string, unknown>, label: string, key?: string) => mutate(label, (draft) => {
        const layer = draft.layers.find((l) => l.id === id);
        if (layer) {
            Object.assign(layer, patch);
        }
    }, key ? { key } : undefined);
    const move = (index: number, delta: number) => mutate(delta < 0 ? t('layers.moveDown') : t('layers.moveUp'), (draft) => {
        const target = index + delta;
        if (target < 0 || target >= draft.layers.length) {
            return;
        }
        const [layer] = draft.layers.splice(index, 1);
        draft.layers.splice(target, 0, layer);
    });
    // Top of the list draws on top: show layers reversed.
    const ordered = project.layers.map((layer, index) => ({ layer, index })).reverse();

    return (
        <div className="stack">
            <section className="section">
                <div className="section__title">
                    {t('panel.layers')}
                    <span className="spacer" />
                    {editable ? (
                        <Button small variant="ghost" disabled={project.layers.length >= LIMITS.layers} title={project.layers.length >= LIMITS.layers ? t('layers.limit', { n: LIMITS.layers }) : undefined} onClick={() => {
                            const layer = createLayer(`${t('layers.newName')} ${project.layers.length + 1}`);
                            mutate(t('layers.add'), (draft) => {
                                draft.layers.push(layer);
                            });
                            useUi.getState().set({ activeLayerId: layer.id });
                        }}><Plus size={16} /> {t('layers.add')}</Button>
                    ) : null}
                </div>
                <ul className="layer-list">
                    {ordered.map(({ layer, index }) => (
                        <li key={layer.id} className={`layer-row ${layer.id === active ? 'is-active' : ''}`}>
                            <div className="layer-row__top">
                                <IconButton small label={layer.visible ? t('common.visible') : t('common.hidden')} pressed={!layer.visible} onClick={() => patchLayer(layer.id, { visible: !layer.visible }, t('common.visible'))} disabled={!editable}>
                                    {layer.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                                </IconButton>
                                {editable ? (
                                    <NameInput className="layer-row__name input" aria-label={t('common.name')} maxLength={MAX.name} value={layer.name} onCommit={(name) => patchLayer(layer.id, { name }, t('common.rename'), `layer-name:${layer.id}`)} />
                                ) : <span className="layer-row__name">{layer.name}</span>}
                                <span className="badge num">{counts.get(layer.id) ?? 0}</span>
                                {editable ? (
                                    <>
                                        <IconButton small label={layer.locked ? t('common.unlock') : t('common.lock')} pressed={layer.locked} onClick={() => patchLayer(layer.id, { locked: !layer.locked }, t('common.lock'))}>
                                            {layer.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                                        </IconButton>
                                        <IconButton small label={t('layers.moveUp')} onClick={() => move(index, 1)} disabled={index === project.layers.length - 1}><ArrowUp size={16} /></IconButton>
                                        <IconButton small label={t('layers.moveDown')} onClick={() => move(index, -1)} disabled={index === 0}><ArrowDown size={16} /></IconButton>
                                        <IconButton small label={t('common.delete')} onClick={() => {
                                            if (project.layers.length <= 1) {
                                                toast(t('layers.deleteBlocked'), { tone: 'warn' });
                                                return;
                                            }
                                            if (layer.locked) {
                                                // Moving locked content into an unlocked layer would silently unlock it.
                                                toast(t('layers.deleteLocked'), { tone: 'warn' });
                                                return;
                                            }
                                            const first = project.layers[0].id;
                                            const fallback = project.layers.find((l) => l.id !== layer.id && !l.locked)?.id ?? project.layers.find((l) => l.id !== layer.id)?.id;
                                            const ok = mutate(t('common.delete'), (draft) => {
                                                draft.layers = draft.layers.filter((l) => l.id !== layer.id);
                                                // Elements and drawings follow the same rule, so peers' repairReferences agrees.
                                                for (const item of [...draft.elements, ...draft.drawings]) {
                                                    if ((item.layerId ?? first) === layer.id) {
                                                        item.layerId = fallback;
                                                    }
                                                }
                                            });
                                            if (ok) {
                                                toastUndoable(t('inspector.deleted', { name: layer.name }));
                                            }
                                        }}><Trash2 size={16} /></IconButton>
                                    </>
                                ) : null}
                            </div>
                            <div className="layer-row__bottom">
                                {editable && !layer.locked ? (
                                    <label className="radio-inline">
                                        <input type="radio" name="active-layer" checked={layer.id === active} onChange={() => useUi.getState().set({ activeLayerId: layer.id })} />
                                        {t('layers.active')}
                                    </label>
                                ) : <span />}
                                <input type="range" className="range layer-row__opacity" aria-label={t('common.opacity')} min={10} max={100} value={Math.round(layer.opacity * 100)} disabled={!editable} onChange={(event) => patchLayer(layer.id, { opacity: Number(event.target.value) / 100 }, t('common.opacity'), `layer-op:${layer.id}`)} />
                            </div>
                        </li>
                    ))}
                </ul>
            </section>
            <section className="section">
                <div className="section__title">{t('layers.basemap')}</div>
                <Switch checked={project.settings.basemapLabels} disabled={!editable} onChange={(value) => mutate(t('layers.basemapLabels'), (draft) => {
                    draft.settings.basemapLabels = value;
                })}>{t('layers.basemapLabels')}</Switch>
                <div className="field">
                    <span className="field__label">{t('layers.grid')}</span>
                    <Segmented block disabled={!editable} value={project.settings.grid} onChange={(grid) => mutate(t('layers.grid'), (draft) => {
                        draft.settings.grid = grid;
                    })} options={[{ value: 'off', label: t('streamer.off') }, { value: '1km', label: '1 km' }, { value: '100m', label: '100 m' }]} />
                </div>
            </section>
            {!editable ? <p className="field__hint"><Lock {...ICON} size={14} /> {t('mode.fieldLocked')}</p> : null}
        </div>
    );
}
