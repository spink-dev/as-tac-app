import { Toasts } from './ui/components';
import { useT } from './i18n';

export function App() {
    const t = useT();
    return (
        <>
            <main className="boot">
                <h1>AS-TAC</h1>
                <p className="muted">{t('app.tagline')}</p>
            </main>
            <Toasts />
        </>
    );
}
