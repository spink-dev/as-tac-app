import { useEffect, useRef } from 'react';
import { setTheme, themeLabels, useTheme, type Theme } from './theme';

export default function Appearance() {
    const theme = useTheme();
    const details = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        const close = (event: PointerEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !details.current?.contains(event.target as Node)) {
                if (event instanceof KeyboardEvent && details.current?.open) {
                    event.stopPropagation();
                    details.current.querySelector('summary')?.focus();
                }
                details.current?.removeAttribute('open');
            }
        };
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', close);
        };
    }, []);
    return (
        <details className="appearance" ref={details}>
            <summary aria-label={`Darstellung: ${themeLabels[theme]}`}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <circle cx="12" cy="12" r="7" />
                    <path d="M12 5a7 7 0 0 1 0 14Z" fill="currentColor" />
                </svg>
                {themeLabels[theme]}
            </summary>
            <div className="appearance-menu">
                <strong>Darstellung</strong>
                <div className="appearance-options" role="group" aria-label="Darstellung wählen">
                    {(Object.keys(themeLabels) as Theme[]).map((value) => (
                        <button
                            key={value}
                            aria-pressed={theme === value}
                            onClick={() => {
                                setTheme(value);
                                details.current?.removeAttribute('open');
                                details.current?.querySelector('summary')?.focus();
                            }}
                        >
                            <span className={`theme-swatch swatch-${value}`} aria-hidden="true" />
                            {themeLabels[value]}
                        </button>
                    ))}
                </div>
                <p>Rotlicht reduziert helle Flächen und zeigt die Karte einfarbig. Teamfarben sind darin nicht unterscheidbar.</p>
                <p className="muted">
                    Für die Nacht zusätzlich die Displayhelligkeit am Gerät reduzieren. Systemdialoge folgen den Geräteeinstellungen.
                </p>
            </div>
        </details>
    );
}
