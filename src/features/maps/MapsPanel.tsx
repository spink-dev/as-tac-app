import { useEffect, useState } from 'react';
import { Crosshair, Download, Eye, EyeOff, ImageOff, ImagePlus, Lock, LockOpen, Trash2 } from 'lucide-react';
import { useT, formatBytes } from '../../i18n';
import { useProject, mutate } from '../../core/store/project';
import { useUi, toast } from '../../core/store/ui';
import { showDialog } from '../../core/store/dialogs';
import { Button, Empty, Field, IconButton } from '../../ui/components';
import { isBundled, listAreas } from '../../core/areas/store';
import { AreaOptions } from '../areas/AreaCatalog';
import type { AreaMeta } from '../../core/areas/types';
import { canEdit, toastUndoable } from '../../core/actions';
import { addImageMap, boundCount, removeImage } from '../../core/images';
import { pickFile } from '../../core/files/save';
import { mapRef } from '../../map/MapView';
import { assetState, assetUrl, onAssetStored } from '../../core/storage/assets';
import { registerPanel } from '../panels/registry';
import { useLive } from '../../core/live/state';
import { loadPictures } from '../../core/live/session';
import { LIMITS, type ImageOverlay } from '../../core/model/schema';
import { t as translate } from '../../i18n';

function imageError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message === 'asset-too-large' || message === 'image-too-large' ? translate('maps.tooLarge') : translate('maps.imageFailed');
}

function Thumb({ image }: { image: ImageOverlay }) {
    const t = useT();
    const live = useLive((state) => state.status !== 'off');
    const transfer = useLive((state) => state.transfers[image.asset]);
    const [state, setState] = useState<{ url: string | null; status: 'loading' | 'ok' | 'missing' | 'unusable' }>({ url: null, status: 'loading' });
    useEffect(() => {
        let alive = true;
        const check = async () => {
            const status = await assetState(image.asset);
            const url = status === 'ok' ? await assetUrl(image.asset) : null;
            if (alive) {
                setState({ url, status });
            }
        };
        void check();
        // A missing picture can still arrive (live partner, later import).
        const stop = onAssetStored((hash) => hash === image.asset && void check());
        return () => {
            alive = false;
            stop();
        };
    }, [image.asset]);
    if (state.status === 'loading') {
        return <span className="thumb skeleton" />;
    }
    if (state.url) {
        return <img className="thumb" src={state.url} alt="" />;
    }
    if (state.status === 'missing' && live) {
        // A live partner's picture held back (data saver) or still on its way: load on tap.
        const percent = transfer?.total ? Math.round((transfer.done / transfer.total) * 100) : null;
        return (
            <button type="button" className="thumb thumb--off thumb--load" onClick={() => loadPictures([image.asset])} disabled={Boolean(transfer)}
                aria-label={transfer ? t('maps.loadingImage', { p: percent ?? '…' }) : t('maps.loadImage')} title={transfer ? undefined : t('maps.loadImage')} data-testid="load-image">
                {transfer ? <span className="num">{percent !== null ? `${percent} %` : '…'}</span> : <Download size={18} aria-hidden />}
            </button>
        );
    }
    const label = state.status === 'missing' ? t('maps.imageMissing') : t('maps.imageUnusable');
    return <span className="thumb thumb--off" role="img" aria-label={label} title={label}><ImageOff size={18} aria-hidden /></span>;
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
        console.warn('image import failed', error);
        toast(imageError(error), { tone: 'danger' });
    }
}

export function MapsPanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    const editing = useUi((state) => state.imageEditId);
    useUi((state) => state.mode);
    useProject((state) => state.readOnly);
    const [areas, setAreas] = useState<AreaMeta[]>([]);
    useEffect(() => {
        void listAreas().then(setAreas);
    }, []);
    if (!project) {
        return null;
    }
    const editable = canEdit();
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
                        <AreaOptions installed={areas} />
                        {project.areaId && !isBundled(project.areaId) && !areas.some((area) => area.id === project.areaId) ? (
                            <option value={project.areaId}>{t('area.missingOption', { id: project.areaId })}</option>
                        ) : null}
                    </select>
                </Field>
                <Button small variant="ghost" onClick={() => showDialog('areaDownload')}><Download size={16} /> {t('new.downloadArea')}</Button>
            </section>
            <section className="section">
                <div className="section__title">
                    {t('maps.images')}
                    <span className="spacer" />
                    {editable ? <Button small variant="primary" disabled={project.images.length >= LIMITS.images} title={project.images.length >= LIMITS.images ? t('maps.limit', { n: LIMITS.images }) : undefined} onClick={() => void pickAndAddImage()}><ImagePlus size={16} /> {t('maps.addImage')}</Button> : null}
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
                                        <IconButton small label={image.locked ? t('align.locked') : t('maps.align')} pressed={editing === image.id} disabled={Boolean(image.locked) && editing !== image.id} onClick={() => useUi.getState().set({ imageEditId: editing === image.id ? null : image.id, tool: 'select', selection: [] })}>
                                            <Crosshair size={16} />
                                        </IconButton>
                                        <IconButton small label={image.locked ? t('common.unlock') : t('common.lock')} pressed={Boolean(image.locked)} onClick={() => patchImage(image.id, { locked: !image.locked || undefined }, `img-lock:${image.id}`)}>
                                            {image.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                                        </IconButton>
                                        <IconButton small label={t('common.delete')} disabled={Boolean(image.locked)} onClick={() => {
                                            removeImage(image.id);
                                            toastUndoable(t('inspector.deleted', { name: image.name }));
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
