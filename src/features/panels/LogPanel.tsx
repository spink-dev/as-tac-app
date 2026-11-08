import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useT } from '../../i18n';
import { useProject } from '../../core/store/project';
import { useUi } from '../../core/store/ui';
import { Button, Empty } from '../../ui/components';
import { canLog, logEvent } from '../../core/actions';
import { MAX } from '../../core/model/schema';
import { flyTo } from '../../map/MapView';
import { elementAnchor } from '../../map/planFeatures';

export function LogPanel() {
    const t = useT();
    const project = useProject((state) => state.project);
    useProject((state) => state.readOnly);
    const mode = useUi((state) => state.mode);
    const selection = useUi((state) => state.selection);
    const [text, setText] = useState('');
    if (!project) {
        return null;
    }
    const submit = () => {
        const value = text.trim();
        if (!value) {
            return;
        }
        const element = project.elements.find((e) => e.id === selection[0]);
        logEvent(value, element?.id, element?.teamId);
        setText('');
    };
    const entries = [...project.log].reverse();
    return (
        <div className="stack">
            {canLog() ? (
                <form className="row-gap log-form" onSubmit={(event) => {
                    event.preventDefault();
                    submit();
                }}>
                    <input className="input" maxLength={MAX.log} value={text} placeholder={t('log.placeholder')} aria-label={t('log.add')} onChange={(event) => setText(event.target.value)} />
                    <Button type="submit" variant="primary" disabled={!text.trim()}><Plus size={18} /><span className="sr-only">{t('log.add')}</span></Button>
                </form>
            ) : null}
            {canLog() && mode === 'field' ? <p className="field__hint">{t('log.fieldHint')}</p> : null}
            {entries.length === 0 ? <Empty>{t('log.empty')}</Empty> : (
                <ol className="log-list">
                    {entries.map((entry) => {
                        const element = project.elements.find((e) => e.id === entry.elementId);
                        const team = project.teams.find((x) => x.id === entry.teamId);
                        return (
                            <li key={entry.id} className="log-row">
                                <time className="log-row__time num" dateTime={entry.t}>{new Date(entry.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                                <span className="log-row__text">
                                    {team ? <span className="dot" style={{ ['--dot' as string]: team.color }} /> : null}
                                    {entry.text}
                                    {element ? (
                                        <button type="button" className="link-btn" onClick={() => {
                                            flyTo({ center: elementAnchor(element) });
                                            useUi.getState().select([element.id]);
                                        }}>{element.label ?? '↗'}</button>
                                    ) : null}
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
