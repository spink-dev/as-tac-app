import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, MapPin } from 'lucide-react';
import { useT, t as translate } from '../../i18n';
import { useDialogs } from '../../core/store/dialogs';
import { Button, Dialog, Field } from '../../ui/components';
import { readImportFile, storeImported, type ImportResult } from '../../core/files/astac';
import type { TacMapPlacement } from '../../core/legacy/tacmap';
import { isIos, pickFile } from '../../core/files/save';
import { BUNDLED_AREAS, bundledArea, listAreas } from '../../core/areas/store';
import { AreaOptions } from '../areas/AreaCatalog';
import type { AreaMeta } from '../../core/areas/types';
import { boundsSizeM } from '../../core/geo/geo';
import { closeProject, openProject, useRoute } from '../../core/store/route';
import { useProject } from '../../core/store/project';
import { toast, useUi } from '../../core/store/ui';
import { mapRef } from '../../map/MapView';

export const IMPORT_ACCEPT = '.astac,.tacmap,.zip,.json,application/zip,application/json';

type Step =
    | { name: 'pick' }
    | { name: 'reading' }
    | { name: 'place'; resolve: (placement: TacMapPlacement) => void }
    | { name: 'done'; result: ImportResult }
    | { name: 'error'; reason: string };

export interface ImportPayload {
    file?: File;
    /** A plan decoded from a `#plan=` link. */
    result?: ImportResult;
}

/** User-facing reason for an import error code (never a raw exception text). */
export function importErrorText(error: unknown): string {
    const code = error instanceof Error ? error.message : String(error);
    if (code.startsWith('archive-too')) {
        return translate('import.errorTooLarge');
    }
    if (code === 'area-too-large') {
        return translate('import.errorAreaTooLarge');
    }
    if (code === 'project-newer' || code === 'area-newer') {
        return translate('import.errorNewer');
    }
    if (code === 'format-unknown') {
        return translate('import.errorFormat');
    }
    if (code.startsWith('archive') || code.startsWith('asset-checksum')) {
        return translate('import.errorDamaged');
    }
    return translate('import.errorInvalid');
}

function PlacementStep({ onPlace }: { onPlace: (placement: TacMapPlacement) => void }) {
    const t = useT();
    const [installed, setInstalled] = useState<AreaMeta[]>([]);
    const [choice, setChoice] = useState('');
    const selectId = useId();
    const map = mapRef.current;
    useEffect(() => {
        void listAreas().then((rows: AreaMeta[]) => {
            setInstalled(rows);
            setChoice(map ? 'view' : rows[0]?.id ?? BUNDLED_AREAS[0]?.id ?? '');
        });
    }, [map]);
    const place = () => {
        if (choice === 'view' && map) {
            const b = map.getBounds();
            const bounds: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
            onPlace({ center: [map.getCenter().lng, map.getCenter().lat], widthM: boundsSizeM(bounds).width * 0.7 });
            return;
        }
        const area = bundledArea(choice) ?? installed.find((a) => a.id === choice);
        if (area) {
            const [w, s, e, n] = area.bounds;
            onPlace({ center: [(w + e) / 2, (s + n) / 2], widthM: boundsSizeM(area.bounds).width * 0.6 });
        }
    };
    return (
        <div className="stack">
            <p className="dialog__lead">{t('share.placeLead')}</p>
            <Field label={t('share.placeTitle')} htmlFor={selectId}>
                <select id={selectId} className="select" autoFocus value={choice} onChange={(event) => setChoice(event.target.value)}>
                    {map ? <option value="view">{t('share.placeHere')}</option> : null}
                    <AreaOptions installed={installed} />
                </select>
            </Field>
            <Button variant="primary" onClick={place} disabled={!choice}><MapPin size={18} /> {t('common.next')}</Button>
        </div>
    );
}

/** Open .astac, .tacmap, as-tac 0.x packages and offline areas; also confirms plans from QR links. */
export function ImportDialog() {
    const t = useT();
    const open = useDialogs((state) => state.open === 'import');
    const payload = useDialogs((state) => (state.open === 'import' ? state.payload as ImportPayload | null : null));
    const hide = useDialogs((state) => state.hide);
    const [step, setStep] = useState<Step>({ name: 'pick' });
    const [dragging, setDragging] = useState(false);
    const [storing, setStoring] = useState(false);
    const abort = useRef<AbortController | null>(null);

    const read = async (file: File) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        // Only the current import may change the dialog (a cancelled one finishes silently).
        const current = () => abort.current === controller && !controller.signal.aborted;
        setStep({ name: 'reading' });
        try {
            const ask = () => new Promise<TacMapPlacement>((resolve, reject) => {
                if (!current()) {
                    reject(new Error('aborted'));
                    return;
                }
                controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                setStep({ name: 'place', resolve });
            });
            const result = await readImportFile(file, ask, controller.signal);
            if (current()) {
                setStep({ name: 'done', result });
            }
        } catch (error) {
            if (current()) {
                console.warn('import failed', error);
                setStep({ name: 'error', reason: importErrorText(error) });
            }
        }
    };

    useEffect(() => {
        if (!open) {
            abort.current?.abort();
            setStep({ name: 'pick' });
            return;
        }
        if (payload?.result) {
            setStep({ name: 'done', result: payload.result });
        } else if (payload?.file) {
            void read(payload.file);
        } else {
            setStep({ name: 'pick' });
        }
    }, [open, payload]);

    const close = () => {
        abort.current?.abort();
        abort.current = null;
        hide();
    };

    const openImported = async (result: ImportResult) => {
        if (result.kind !== 'project') {
            close();
            return;
        }
        if (storing) {
            return;
        }
        setStoring(true);
        if (useRoute.getState().route.name === 'workspace' && !(await closeProject())) {
            setStoring(false);
            return;
        }
        try {
            const stored = await storeImported(result.project, t('import.copySuffix'));
            hide();
            await openProject(stored.id);
            toast(t('share.imported', { name: stored.name }), { tone: 'ok' });
            if (result.unaligned.length > 0 && useProject.getState().project?.images.some((image) => image.id === result.unaligned[0])) {
                useUi.getState().set({ imageEditId: result.unaligned[0], tool: 'select' });
                toast(t('maps.unaligned'));
            }
        } catch (error) {
            console.warn('storing import failed', error);
            setStep({ name: 'error', reason: t('error.storage') });
        } finally {
            setStoring(false);
        }
    };

    const body = () => {
        switch (step.name) {
            case 'pick':
                return (
                    <div
                        className={`dropzone ${dragging ? 'is-over' : ''}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragging(false);
                            const file = event.dataTransfer.files[0];
                            if (file) {
                                void read(file);
                            }
                        }}
                    >
                        <FileUp size={28} strokeWidth={1.6} aria-hidden />
                        <p>{t('share.importHint')}</p>
                        <Button variant="primary" data-testid="import-pick" autoFocus onClick={async () => {
                            // iOS greys out files whose extension it doesn't know: no filter there.
                            const file = await pickFile(isIos() ? '' : IMPORT_ACCEPT);
                            if (file) {
                                void read(file);
                            }
                        }}>{t('import.choose')}</Button>
                        <p className="field__hint">{t('import.privacy')}</p>
                    </div>
                );
            case 'reading':
                return <p className="dialog__lead" role="status">{t('import.reading')}</p>;
            case 'place':
                return <PlacementStep onPlace={(placement) => {
                    setStep({ name: 'reading' });
                    step.resolve(placement);
                }} />;
            case 'error':
                return (
                    <div className="notice notice--danger" role="alert">
                        <AlertTriangle size={18} /> {step.reason}
                    </div>
                );
            case 'done': {
                const result = step.result;
                if (result.kind === 'area') {
                    return (
                        <div className="notice notice--ok" role="status"><CheckCircle2 size={18} /> {t('import.areaDone', { name: result.area.name })}</div>
                    );
                }
                const p = result.project;
                return (
                    <div className="stack" data-testid="import-summary">
                        <div className="import-summary">
                            <strong className="import-summary__name">{p.name}</strong>
                            <span className="muted">{t(`import.source.${result.source}`)}</span>
                            <ul className="import-summary__counts num">
                                <li>{t('layers.elements', { n: p.elements.length })}</li>
                                {p.images.length > 0 ? <li>{t('import.images', { n: p.images.length })}</li> : null}
                                {p.teams.length > 0 ? <li>{t('import.teams', { n: p.teams.length })}</li> : null}
                                {p.phases.length > 0 ? <li>{t('import.phases', { n: p.phases.length })}</li> : null}
                                {result.area ? <li>{t('import.withArea', { name: result.area.name })}</li> : null}
                            </ul>
                        </div>
                        {result.unaligned.length > 0 ? <p className="notice notice--warn">{t('import.needsAlign', { n: result.unaligned.length })}</p> : null}
                        {result.skipped > 0 ? <p className="notice notice--warn">{t('import.skipped', { n: result.skipped })}</p> : null}
                        {result.missingAssets > 0 ? <p className="notice notice--warn">{t('import.missingAssets', { n: result.missingAssets })}</p> : null}
                        {result.source === 'link' ? <p className="field__hint">{t('import.linkNote')}</p> : null}
                    </div>
                );
            }
        }
    };

    const footer = step.name === 'done'
        ? (
            <>
                <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
                <Button variant="primary" data-testid="import-open" autoFocus disabled={storing} onClick={() => void openImported(step.result)}>{step.result.kind === 'project' ? t('share.openCopy') : t('common.done')}</Button>
            </>
        )
        : step.name === 'error'
            ? <Button autoFocus onClick={() => setStep({ name: 'pick' })}>{t('common.retry')}</Button>
            : step.name === 'reading' ? <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button> : undefined;

    return (
        <Dialog open={open} onClose={close} title={t('share.importTitle')} footer={footer}>
            {body()}
        </Dialog>
    );
}
