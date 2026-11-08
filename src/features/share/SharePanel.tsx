import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Copy, Download, Map as MapIcon, QrCode, Send } from 'lucide-react';
import { encode } from 'uqr';
import { useT, formatBytes } from '../../i18n';
import { useProject } from '../../core/store/project';
import { toast, useUi } from '../../core/store/ui';
import { Button, Empty, Switch } from '../../ui/components';
import { astacFilename, exportAstac } from '../../core/files/astac';
import { encodePlanLink } from '../../core/files/link';
import { saveFile, shareFile } from '../../core/files/save';
import { exportAreaFile } from '../../core/areas/files';
import { hasArea } from '../../core/areas/store';
import type { AreaMeta } from '../../core/areas/types';
import { flushNow } from '../../core/storage/projects';
import { registerPanel } from '../panels/registry';

/** Scalable QR code drawn as one SVG path (crisp at any size, works offline). */
export function QrSvg({ text, label }: { text: string; label: string }) {
    const path = useMemo(() => {
        const { data, size } = encode(text, { ecc: 'L', border: 2 });
        let d = '';
        data.forEach((row, y) => row.forEach((on, x) => {
            if (on) {
                d += `M${x} ${y}h1v1h-1z`;
            }
        }));
        return { d, size };
    }, [text]);
    return (
        <div className="qr">
            <svg viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
                <rect width={path.size} height={path.size} fill="#fff" />
                <path d={path.d} fill="#000" />
            </svg>
        </div>
    );
}

export function appBaseUrl(): string {
    return `${location.origin}${import.meta.env.BASE_URL}`;
}

export function SharePanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    const [area, setArea] = useState<AreaMeta | null>(null);
    const [includeArea, setIncludeArea] = useState(true);
    const [includeTracks, setIncludeTracks] = useState(false);
    const [busy, setBusy] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const areaId = project?.areaId ?? null;
    useEffect(() => {
        if (areaId) {
            void hasArea(areaId).then((meta) => setArea(meta ?? null));
        } else {
            setArea(null);
        }
    }, [areaId]);
    // Deferred: re-encoding the QR on every keystroke would stall typing in other panels.
    const deferred = useDeferredValue(project);
    const streamer = useUi((state) => state.streamer);
    const link = useMemo(() => (deferred && showQr ? encodePlanLink(deferred, appBaseUrl()) : null), [deferred, showQr]);
    if (!project) {
        return null;
    }
    const build = async () => {
        // Write pending edits first so the file matches what is on screen.
        await flushNow();
        return exportAstac(project, { includeArea: includeArea && Boolean(area), includeTracks });
    };
    const run = async (mode: 'share' | 'download') => {
        setBusy(true);
        try {
            const { blob, missing } = await build();
            const filename = astacFilename(project);
            if (mode === 'share') {
                const how = await shareFile(blob, filename, project.name);
                if (how === 'shared') {
                    toast(t('share.sent'), { tone: 'ok' });
                } else if (how === 'downloaded') {
                    toast(t('share.downloaded'), { tone: 'ok' });
                }
            } else {
                saveFile(blob, filename);
            }
            if (missing > 0) {
                toast(t('share.missingImages', { n: missing }), { tone: 'warn' });
            }
        } catch (error) {
            console.warn('export failed', error);
            toast(t('share.exportError'), { tone: 'danger' });
        } finally {
            setBusy(false);
        }
    };
    const canShareFiles = typeof navigator.canShare === 'function';

    return (
        <div className="stack">
            <section className="section">
                <div className="section__title">{t('share.file')}</div>
                <p className="field__hint">{t('share.fileHint')}</p>
                {area ? (
                    <Switch checked={includeArea} onChange={setIncludeArea}>{t('share.includeArea', { size: formatBytes(area.byteSize) })}</Switch>
                ) : <p className="field__hint">{t('share.noArea')}</p>}
                {project.tracks.length > 0 ? (
                    <>
                        <Switch checked={includeTracks} onChange={setIncludeTracks}>{t('field.includeTracks', { n: project.tracks.length })}</Switch>
                        <p className="field__hint">{t('field.trackPrivacy')}</p>
                    </>
                ) : null}
                <div className="row-gap">
                    {canShareFiles ? <Button variant="primary" disabled={busy} onClick={() => void run('share')} data-testid="share-send"><Send size={18} /> {t('share.send')}</Button> : null}
                    <Button variant={canShareFiles ? 'secondary' : 'primary'} disabled={busy} onClick={() => void run('download')} data-testid="share-download"><Download size={18} /> {t('share.download')}</Button>
                </div>
            </section>
            <section className="section">
                <div className="section__title">{t('share.qr')}</div>
                {streamer !== 'off' ? (
                    // Streamer Safe: a full-plan QR code on screen would hand the plan to every viewer.
                    <p className="notice">{t('share.qrStreamer')}</p>
                ) : !showQr ? (
                    <Button onClick={() => setShowQr(true)} data-testid="share-qr"><QrCode size={18} /> {t('share.qr')}</Button>
                ) : link ? (
                    <>
                        <QrSvg text={link} label={t('share.qr')} />
                        <p className="field__hint">{t('share.qrHint')} {t('share.qrPrivacy')}</p>
                        <Button small variant="ghost" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast(t('share.linkCopied'), { tone: 'ok' }))}><Copy size={16} /> {t('share.copyLink')}</Button>
                    </>
                ) : <Empty>{t('share.qrTooLarge')}</Empty>}
            </section>
            {area ? (
                <section className="section">
                    <div className="section__title">{t('maps.areas')}</div>
                    <p className="field__hint">{t('share.areaFileHint')}</p>
                    <Button small variant="ghost" onClick={async () => {
                        const { blob, filename } = await exportAreaFile(area.id);
                        saveFile(blob, filename);
                    }}><MapIcon size={16} /> {t('share.areaFile')}</Button>
                </section>
            ) : null}
        </div>
    );
}

registerPanel('share', 'panel.share', SharePanel);
