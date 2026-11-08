import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, FileUp, HardDrive, Map as MapIcon, MoreHorizontal, Pencil, Plus, Radio, Trash2, Wifi, WifiOff } from 'lucide-react';
import { areaErrorText } from '../areas/areaErrors';
import { useT, relativeTime, formatBytes } from '../../i18n';
import { usePrefs } from '../../core/store/prefs';
import { Button, ICON, IconButton, useSmoothScroll, useStaggerIn } from '../../ui/components';
import { AppearanceToggle, BrandMark, LanguageToggle } from '../../ui/Brand';
import { showDialog } from '../../core/store/dialogs';
import { deleteProject, duplicateStored, listProjects, loadProject, saveProject } from '../../core/storage/projects';
import type { ProjectIndexRow } from '../../core/storage/db';
import { requestPersistence, storageEstimate } from '../../core/storage/db';
import { openProject } from '../../core/store/route';
import { toast } from '../../core/store/ui';
import { BUNDLED_AREAS, installBundled, listAreas, removeArea, areaUsage } from '../../core/areas/store';
import type { AreaMeta } from '../../core/areas/types';
import { usePwa } from '../../core/pwa';
import { AppInfo, UpdateBanner } from '../update/Update';
import { LegacyBanner } from './LegacyBanner';
import { exportAreaFile } from '../../core/areas/files';
import { saveFile } from '../../core/files/save';

export function Library() {
    const t = useT();
    const locale = usePrefs((state) => state.locale);
    const [projects, setProjects] = useState<ProjectIndexRow[] | null>(null);
    const [areas, setAreas] = useState<AreaMeta[]>([]);
    const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
    const [menu, setMenu] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [installing, setInstalling] = useState<Record<string, number>>({});
    const scroller = useSmoothScroll<HTMLDivElement>();
    const listRef = useStaggerIn<HTMLUListElement>([projects === null]);
    const pwa = usePwa();
    const statusText = pwa.offlineReady ? t('library.offlineReady') : navigator.onLine ? t('common.online') : t('common.offline');

    const refresh = useCallback(async () => {
        const [p, a, s] = await Promise.all([listProjects(), listAreas(), storageEstimate()]);
        setProjects(p);
        setAreas(a);
        setStorage(s);
    }, []);

    useEffect(() => {
        void refresh();
        const onFocus = () => void refresh();
        window.addEventListener('focus', onFocus);
        window.addEventListener('as-tac:library-changed', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('as-tac:library-changed', onFocus);
        };
    }, [refresh]);

    async function remove(row: ProjectIndexRow) {
        setMenu(null);
        const backup = await loadProject(row.id).catch(() => null);
        await deleteProject(row.id);
        await refresh();
        toast(t('library.deleted'), backup ? {
            action: {
                label: t('common.undo'),
                run: () => void saveProject(backup).then(refresh),
            },
        } : undefined);
    }

    async function duplicate(row: ProjectIndexRow) {
        setMenu(null);
        await duplicateStored(row.id, `${row.name} (2)`);
        await refresh();
    }

    async function rename(row: ProjectIndexRow, name: string) {
        setRenaming(null);
        const trimmed = name.trim();
        if (!trimmed || trimmed === row.name) {
            return;
        }
        const project = await loadProject(row.id);
        project.name = trimmed;
        project.updatedAt = new Date().toISOString();
        await saveProject(project);
        await refresh();
    }

    async function install(id: string) {
        setInstalling((state) => ({ ...state, [id]: 0 }));
        try {
            await installBundled(id, (fraction) => setInstalling((state) => ({ ...state, [id]: fraction ?? state[id] ?? 0 })));
            toast(t('area.saved', { name: BUNDLED_AREAS.find((a) => a.id === id)?.name ?? id }), { tone: 'ok' });
        } catch (error) {
            toast(areaErrorText(error), { tone: 'danger' });
        } finally {
            setInstalling((state) => {
                const next = { ...state };
                delete next[id];
                return next;
            });
            await refresh();
        }
    }

    async function uninstall(area: AreaMeta) {
        const used = await areaUsage(area.id);
        if (used > 0) {
            toast(t('area.inUse', { n: used }), { tone: 'warn' });
            return;
        }
        await removeArea(area.id);
        await refresh();
    }

    const areaRows = [
        ...BUNDLED_AREAS.map((bundled) => ({ id: bundled.id, name: bundled.name, bundled: true, meta: areas.find((a) => a.id === bundled.id), size: bundled.approxBytes, description: bundled.description })),
        ...areas.filter((area) => !BUNDLED_AREAS.some((b) => b.id === area.id)).map((area) => ({ id: area.id, name: area.name, bundled: false, meta: area, size: area.byteSize, description: '' })),
    ];

    return (
        <div className="lib" ref={scroller}>
            <div className="lib__inner">
                <header className="lib__head">
                    <div className="lib__brand">
                        <BrandMark size={30} />
                        <span className="lib__word">AS-TAC</span>
                    </div>
                    <div className="spacer" />
                    <span className={`badge lib__status ${pwa.offlineReady ? 'badge--ok' : ''}`} title={statusText}>
                        {navigator.onLine ? <Wifi size={14} strokeWidth={2} aria-hidden="true" /> : <WifiOff size={14} strokeWidth={2} aria-hidden="true" />}
                        <span className="lib__status-text">{statusText}</span>
                    </span>
                    <LanguageToggle />
                    <AppearanceToggle />
                </header>

                <UpdateBanner />

                <LegacyBanner onImported={() => void refresh()} />

                <section className="lib__actions" aria-label={t('library.title')}>
                    <Button variant="primary" onClick={() => showDialog('newPlan')} data-testid="new-plan">
                        <Plus {...ICON} /> {t('library.new')}
                    </Button>
                    <Button onClick={() => showDialog('import')}>
                        <FileUp {...ICON} /> {t('library.open')}
                    </Button>
                    <Button onClick={() => showDialog('join')}>
                        <Radio {...ICON} /> {t('library.join')}
                    </Button>
                </section>

                <div className="lib__grid">
                    <section className="lib__plans" aria-labelledby="plans-title">
                        <h2 id="plans-title" className="lib__h">{t('library.title')}</h2>
                        {projects === null ? (
                            <div className="stack">
                                <div className="skeleton" style={{ height: 64 }} />
                                <div className="skeleton" style={{ height: 64 }} />
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="lib__empty">
                                <h3>{t('library.empty.title')}</h3>
                                <p>{t('library.empty.body')}</p>
                                <div className="row-gap">
                                    <Button variant="primary" onClick={() => showDialog('newPlan', { areaId: 'mahlwinkel' })}>
                                        <MapIcon {...ICON} /> Mahlwinkel
                                    </Button>
                                    <Button onClick={() => showDialog('newPlan', { areaId: 'zurich' })}>
                                        <MapIcon {...ICON} /> Zürich
                                    </Button>
                                    <Button variant="ghost" onClick={() => showDialog('areaDownload')}>
                                        <Download {...ICON} /> {t('new.downloadArea')}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <ul className="plan-list" ref={listRef}>
                                {projects.map((row) => (
                                    <li key={row.id} className="plan-row">
                                        {renaming === row.id ? (
                                            <form className="plan-row__rename" onSubmit={(event) => {
                                                event.preventDefault();
                                                void rename(row, new FormData(event.currentTarget).get('name') as string);
                                            }}>
                                                <input name="name" className="input" aria-label={t('common.rename')} defaultValue={row.name} autoFocus onBlur={(event) => void rename(row, event.target.value)} />
                                                <IconButton label={t('common.save')} type="submit"><Check {...ICON} /></IconButton>
                                            </form>
                                        ) : (
                                            <button type="button" className="plan-row__open" onClick={() => void openProject(row.id).catch(() => toast(t('error.generic'), { tone: 'danger' }))} data-testid="open-plan">
                                                <span className="plan-row__title">{row.name}</span>
                                                <span className="plan-row__meta">
                                                    {[
                                                        areaRows.find((a) => a.id === row.areaId)?.name ?? (row.areaId ? row.areaId : t('new.noArea')),
                                                        t('library.elements', { n: row.elementCount }),
                                                        t('library.updated', { when: relativeTime(row.updatedAt, locale) }),
                                                    ].join(' · ')}
                                                </span>
                                            </button>
                                        )}
                                        {row.live ? <span className="badge badge--accent">{t('library.live')}</span> : null}
                                        <div className="plan-row__menu">
                                            <IconButton label={t('common.more')} tipPos="left" aria-expanded={menu === row.id} onClick={() => setMenu(menu === row.id ? null : row.id)}>
                                                <MoreHorizontal {...ICON} />
                                            </IconButton>
                                            {menu === row.id ? (
                                                <div className="menu" role="menu" onMouseLeave={() => setMenu(null)}>
                                                    <button role="menuitem" className="menu__item" onClick={() => {
                                                        setMenu(null);
                                                        setRenaming(row.id);
                                                    }}><Pencil size={16} /> {t('common.rename')}</button>
                                                    <button role="menuitem" className="menu__item" onClick={() => void duplicate(row)}><Copy size={16} /> {t('common.duplicate')}</button>
                                                    <button role="menuitem" className="menu__item menu__item--danger" onClick={() => void remove(row)}><Trash2 size={16} /> {t('common.delete')}</button>
                                                </div>
                                            ) : null}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <aside className="lib__side">
                        <section aria-labelledby="areas-title" className="lib__card">
                            <div className="row-gap">
                                <h2 id="areas-title" className="lib__h">{t('library.areas')}</h2>
                                <div className="spacer" />
                                <Button small variant="ghost" onClick={() => showDialog('areaDownload')}>
                                    <Download size={16} /> {t('area.download')}
                                </Button>
                            </div>
                            <ul className="area-list">
                                {areaRows.map((area) => (
                                    <li key={area.id} className="area-row">
                                        <div className="list-row__main">
                                            <span className="list-row__title">{area.name}</span>
                                            <span className="list-row__meta">
                                                {area.meta ? `${t('area.installed')} · ${formatBytes(area.meta.byteSize)}` : `${t('area.bundled')} · ${formatBytes(area.size)}`}
                                            </span>
                                            {installing[area.id] !== undefined ? (
                                                <div className="progress"><div className="progress__bar" style={{ transform: `scaleX(${Math.max(0.04, installing[area.id])})` }} /></div>
                                            ) : null}
                                        </div>
                                        {area.meta ? (
                                            <>
                                                <IconButton label={t('area.exportFile')} tipPos="left" onClick={() => void exportAreaFile(area.id).then(({ blob, filename }) => saveFile(blob, filename)).catch(() => toast(t('error.generic'), { tone: 'danger' }))}>
                                                    <Download {...ICON} />
                                                </IconButton>
                                                <IconButton label={t('area.remove')} tipPos="left" onClick={() => void uninstall(area.meta as AreaMeta)}>
                                                    <Trash2 {...ICON} />
                                                </IconButton>
                                            </>
                                        ) : (
                                            <Button small onClick={() => void install(area.id)} disabled={installing[area.id] !== undefined}>
                                                <HardDrive size={16} /> {t('area.install')}
                                            </Button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <p className="field__hint">{t('area.attribution')}</p>
                        </section>

                        <section className="lib__card lib__device">
                            <h2 className="lib__h">{t('settings.device')}</h2>
                            {storage ? (
                                <div className="row-gap">
                                    <span className="muted num">{t('library.storage', { used: formatBytes(storage.usage), quota: formatBytes(storage.quota) })}</span>
                                    <div className="spacer" />
                                    {storage.persisted ? (
                                        <span className="badge badge--ok">{t('library.persisted')}</span>
                                    ) : (
                                        <Button small onClick={() => void requestPersistence().then(refresh)}>{t('library.persist')}</Button>
                                    )}
                                </div>
                            ) : null}
                            <AppInfo />
                            <div className="row-gap">
                                <Button small variant="ghost" onClick={() => showDialog('credits')}>{t('library.credits')}</Button>
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
}
