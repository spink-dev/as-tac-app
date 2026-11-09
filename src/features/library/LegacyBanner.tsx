import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useT } from '../../i18n';
import { Button, ICON } from '../../ui/components';
import { dismissLegacy, importLegacy, scanLegacy, type LegacyScan } from '../../core/legacy/oldDb';
import { toast } from '../../core/store/ui';

/** Offers plans saved by as-tac ≤ 0.6 on this origin. The old database is left untouched. */
export function LegacyBanner({ onImported }: { onImported: () => void }) {
    const t = useT();
    const [scan, setScan] = useState<LegacyScan | null>(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void scanLegacy().then(setScan).catch(() => setScan(null));
    }, []);
    if (!scan) {
        return null;
    }
    return (
        <div className="notice lib__legacy">
            <History {...ICON} />
            <span className="spacer">{t('library.legacyFound', { n: scan.projects.length })}</span>
            <Button small variant="ghost" onClick={() => {
                void dismissLegacy();
                setScan(null);
            }}>{t('common.close')}</Button>
            <Button small variant="primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                    const { imported, skipped } = await importLegacy(scan);
                    toast(t('share.imported', { name: `${imported}` }) + (skipped ? ` · ${skipped} ✕` : ''), { tone: skipped ? 'warn' : 'ok' });
                    setScan(null);
                    onImported();
                } catch {
                    toast(t('error.generic'), { tone: 'danger' });
                } finally {
                    setBusy(false);
                }
            }}>{t('library.legacyImport')}</Button>
        </div>
    );
}
