import { useEffect, useState } from 'react';
import { Crosshair, Download, Eye, EyeOff, ImagePlus, Lock, LockOpen, Trash2 } from 'lucide-react';
import { useT, formatBytes } from '../../i18n';
import { useProject, mutate } from '../../core/store/project';
import { useUi, toast } from '../../core/store/ui';
import { showDialog } from '../../core/store/dialogs';
import { Button, Empty, Field, IconButton } from '../../ui/components';
import { BUNDLED_AREAS, listAreas } from '../../core/areas/store';
import type { AreaMeta } from '../../core/areas/types';
import { canEdit } from '../../core/actions';
import { addImageMap, boundCount, removeImage } from '../../core/images';
import { pickFile } from '../../core/files/save';
import { mapRef } from '../../map/MapView';
import { assetUrl } from '../../core/storage/assets';
import { registerPanel } from '../panels/registry';
import type { ImageOverlay } from '../../core/model/schema';

function Thumb({ image }: { image: ImageOverlay }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        void assetUrl(image.asset).then(setUrl);
    }, [image.asset]);
    return url ? <img className="thumb" src={url} alt="" /> : <span className="thumb skeleton" />;
}

export async function pickAndAddImage() {
    const map = mapRef.current;
    const file = await pickFile('image/png,image/jpeg,image/webp,image/gif');
    if (!file || !map) {
        return;
    }
    const center = map.getCenter();
    const b = map.getBounds();
    try {
        await addImageMap(file, { center: [center.lng, center.lat], bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
    } catch (error) {
        toast(String(error instanceof Error ? error.message : error), { tone: 'danger' });
    }
}

export function MapsPanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    const editing = useUi((state) => state.imageEditId);
    const [areas, setAreas] = useState<AreaMeta[]>([]);
    useEffect(() => {
        void listAreas().then(setAreas);
    }, []);
    if (!project) {
        return null;
    }
    const editable = canEdit();
    const options = [
        ...BUNDLED_AREAS.map((area) => ({ id: area.id, name: area.name })),
        ...areas.filter((area) => !BUNDLED_AREAS.some((b) => b.id === area.id)).map((area) => ({ id: area.id, name: area.name })),
    ];
    const current = areas.find((area) => area.id === project.areaId);
    const patchImage = (id: string, patch: Partial<ImageOverlay>, key: string) => mutate(t('maps.images'), (draft) => {
        const image = draft.images.find((i) => i.id === id);
        if (image) {
            Object.assign(image, patch);
        }
    }, { key });

    return (
        <div className="stack">
            <section className="section">
                <div className="section__title">{t('maps.areas')}</div>
                <Field label={t('maps.change')} hint={current ? `${t('area.features', { n: current.featureCount ?? 0, size: formatBytes(current.byteSize) })} · ${t('area.attribution')}` : t('area.attribution')}>
                    <select className="select" value={project.areaId ?? ''} disabled={!editable} onChange={(event) => mutate(t('maps.change'), (draft) => {
                        draft.areaId = event.target.value || null;
                    })}>
                        <option value="">{t('new.noArea')}</option>
                        {options.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                    </select>
                </Field>
                <Button small variant="ghost" onClick={() => showDialog('areaDownload')}><Download size={16} /> {t('new.downloadArea')}</Button>
            </section>
            <section className="section">
                <div className="section__title">
                    {t('maps.images')}
                    <span className="spacer" />
                    {editable ? <Button small variant="primary" onClick={() => void pickAndAddImage()}><ImagePlus size={16} /> {t('maps.addImage')}</Button> : null}
                </div>
                {project.images.length === 0 ? <Empty>{t('maps.imageHint')}</Empty> : null}
                <ul className="image-list">
                    {[...project.images].reverse().map((image) => (
                        <li key={image.id} className={`image-row ${editing === image.id ? 'is-active' : ''}`}>
                            <Thumb image={image} />
                            <div className="list-row__main">
                                <span className="list-row__title">{image.name}</span>
                                <span className="list-row__meta">
                                    {image.fit?.method === 'manual' || !image.fit
                                        ? t('maps.unaligned')
                                        : t('maps.fitQuality', { rms: String(image.fit.rmsM ?? '–'), max: String(image.fit.maxM ?? '–') })}
                                    {boundCount(project, image.id) > 0 ? ` · ⌖ ${boundCount(project, image.id)}` : ''}
                                </span>
                                <input type="range" className="range image-row__opacity" aria-label={t('common.opacity')} min={10} max={100} value={Math.round(image.opacity * 100)} disabled={!editable}
                                    onChange={(event) => patchImage(image.id, { opacity: Number(event.target.value) / 100 }, `img-op:${image.id}`)} />
                            </div>
                            <div className="image-row__actions">
                                <IconButton small label={image.visible ? t('common.visible') : t('common.hidden')} pressed={!image.visible} disabled={!editable} onClick={() => patchImage(image.id, { visible: !image.visible }, `img-vis:${image.id}`)}>
                                    {image.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                                </IconButton>
                                {editable ? (
                                    <>
                                        <IconButton small label={t('maps.align')} pressed={editing === image.id} onClick={() => useUi.getState().set({ imageEditId: editing === image.id ? null : image.id, tool: 'select', selection: [] })}>
                                            <Crosshair size={16} />
                                        </IconButton>
                                        <IconButton small label={image.locked ? t('common.unlock') : t('common.lock')} pressed={Boolean(image.locked)} onClick={() => patchImage(image.id, { locked: !image.locked || undefined }, `img-lock:${image.id}`)}>
                                            {image.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                                        </IconButton>
                                        <IconButton small label={t('common.delete')} onClick={() => {
                                            removeImage(image.id);
                                            toast(t('inspector.deleted', { name: image.name }), { action: { label: t('common.undo'), run: () => useProject.getState().undo() } });
                                        }}><Trash2 size={16} /></IconButton>
                                    </>
                                ) : null}
                            </div>
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
}

registerPanel('maps', 'panel.maps', MapsPanel);
