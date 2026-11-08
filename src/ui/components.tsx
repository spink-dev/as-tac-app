import { useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import gsap from 'gsap';
import Lenis from 'lenis';
import { useUi } from '../core/store/ui';
import { useT } from '../i18n';

export const ICON = { size: 20, strokeWidth: 1.75 } as const;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'secondary', block, small, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean; small?: boolean }) {
    const classes = ['btn', variant !== 'secondary' && `btn--${variant}`, block && 'btn--block', small && 'btn--sm', className].filter(Boolean).join(' ');
    return <button type="button" className={classes} {...rest} />;
}

export function IconButton({ label, pressed, small, tipPos, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; pressed?: boolean; small?: boolean; tipPos?: 'right' | 'bottom' | 'left' }) {
    return (
        <button
            type="button"
            className={`icon-btn ${small ? 'icon-btn--sm' : ''} ${className}`}
            aria-label={label}
            aria-pressed={pressed === undefined ? undefined : pressed}
            data-tip={label}
            data-tip-pos={tipPos}
            {...rest}
        >
            {children}
        </button>
    );
}

export function Segmented<T extends string>({ value, options, onChange, block, label, disabled }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (value: T) => void; block?: boolean; label?: string; disabled?: boolean }) {
    return (
        <div className={`seg ${block ? 'seg--block' : ''}`} role="group" aria-label={label}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className="seg__item"
                    aria-pressed={option.value === value}
                    title={option.title}
                    disabled={disabled}
                    onClick={() => onChange(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

/**
 * Text input for a required name: can be cleared and retyped (a local draft), commits every
 * non-blank change live, and falls back to the stored name when left blank.
 */
export function NameInput({ value, onCommit, className = 'input', ...rest }: { value: string; onCommit: (value: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
    const [draft, setDraft] = useState(value);
    const editing = useRef(false);
    useEffect(() => {
        if (!editing.current) {
            setDraft(value);
        }
    }, [value]);
    return (
        <input
            {...rest}
            className={className}
            value={draft}
            onFocus={(event) => {
                editing.current = true;
                rest.onFocus?.(event);
            }}
            onChange={(event) => {
                setDraft(event.target.value);
                if (event.target.value.trim()) {
                    onCommit(event.target.value);
                }
            }}
            onBlur={(event) => {
                editing.current = false;
                if (!draft.trim()) {
                    setDraft(value);
                }
                rest.onBlur?.(event);
            }}
        />
    );
}

export function Switch({ checked, onChange, children, disabled }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; disabled?: boolean }) {
    return (
        <label className="switch">
            <span className="switch__text">{children}</span>
            <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        </label>
    );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
    return (
        <div className="field">
            <label className="field__label" htmlFor={htmlFor}>{label}</label>
            {children}
            {hint ? <span className="field__hint">{hint}</span> : null}
        </div>
    );
}

export function Swatches({ value, colors, onChange, allowCustom = true }: { value?: string; colors: string[]; onChange: (color: string) => void; allowCustom?: boolean }) {
    return (
        <div className="swatches">
            {colors.map((color) => (
                <button
                    key={color}
                    type="button"
                    className="swatch"
                    style={{ ['--swatch' as string]: color }}
                    aria-label={color}
                    aria-pressed={value?.toLowerCase() === color.toLowerCase()}
                    onClick={() => onChange(color)}
                />
            ))}
            {allowCustom ? (
                <label className="swatch swatch--custom" aria-label="custom colour" style={value && !colors.includes(value) ? { ['--swatch' as string]: value, background: value } : undefined}>
                    <span aria-hidden>+</span>
                    <input type="color" value={value ?? '#888888'} onChange={(event) => onChange(event.target.value)} />
                </label>
            ) : null}
        </div>
    );
}

export function Dialog({ open, onClose, title, children, footer, wide, labelledBy }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; labelledBy?: string }) {
    const ref = useRef<HTMLDialogElement>(null);
    const pressedBackdrop = useRef(false);
    const fallbackId = useId();
    const titleId = labelledBy ?? fallbackId;
    const t = useT();
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) {
            return;
        }
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);
    return (
        <dialog
            ref={ref}
            className={`dialog ${wide ? 'dialog--wide' : ''}`}
            aria-labelledby={titleId}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onPointerDown={(event) => {
                pressedBackdrop.current = event.target === ref.current;
            }}
            onClick={(event) => {
                if (event.target === ref.current && pressedBackdrop.current) {
                    onClose();
                }
                pressedBackdrop.current = false;
            }}
        >
            {open ? (
                <>
                    <div className="dialog__head">
                        <h2 id={titleId}>{title}</h2>
                        <IconButton label={t('common.close')} onClick={onClose} tipPos="left">
                            <X {...ICON} />
                        </IconButton>
                    </div>
                    <div className="dialog__body">{children}</div>
                    {footer ? <div className="dialog__foot">{footer}</div> : null}
                </>
            ) : null}
        </dialog>
    );
}

export function Toasts() {
    const toasts = useUi((state) => state.toasts);
    const dismiss = useUi((state) => state.dismissToast);
    return (
        <div className="toasts" role="status" aria-live="polite">
            {toasts.map((toast) => (
                <ToastItem key={toast.id} text={toast.text} action={toast.action} onDismiss={() => dismiss(toast.id)} />
            ))}
        </div>
    );
}

function ToastItem({ text, action, onDismiss }: { text: string; action?: { label: string; run: () => void }; onDismiss: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (ref.current && !prefersReducedMotion()) {
            gsap.fromTo(ref.current, { y: 12, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.24, ease: 'power3.out' });
        }
    }, []);
    return (
        <div className="toast" ref={ref}>
            <span className="toast__text">{text}</span>
            {action ? (
                <Button
                    small
                    onClick={() => {
                        action.run();
                        onDismiss();
                    }}
                >
                    {action.label}
                </Button>
            ) : null}
        </div>
    );
}

export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Lenis smooth scrolling for wheel/trackpad on long lists. Touch keeps native scrolling
 * (momentum and overscroll behave as users expect on phones) and reduced motion disables it.
 */
/**
 * Lenis smooth scrolling on fine pointers. A callback ref, so it attaches whenever the
 * scroller mounts (also after a conditional render) and is torn down when it unmounts.
 */
export function useSmoothScroll<T extends HTMLElement>() {
    const cleanup = useRef<(() => void) | null>(null);
    useEffect(() => () => {
        cleanup.current?.();
        cleanup.current = null;
    }, []);
    return useCallback((wrapper: T | null) => {
        cleanup.current?.();
        cleanup.current = null;
        const content = wrapper?.firstElementChild as HTMLElement | null;
        if (!wrapper || !content || prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) {
            return;
        }
        const lenis = new Lenis({ wrapper, content, duration: 0.9, easing: (x) => 1 - Math.pow(1 - x, 4), syncTouch: false });
        const tick = (time: number) => {
            lenis.raf(time * 1000);
        };
        gsap.ticker.add(tick);
        cleanup.current = () => {
            gsap.ticker.remove(tick);
            lenis.destroy();
        };
    }, []);
}

/** Animated tabular number (React Bits "CountUp" pattern, GSAP-driven). */
export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
    const [display, setDisplay] = useState(value);
    const current = useRef({ n: value });
    useEffect(() => {
        if (prefersReducedMotion()) {
            current.current.n = value;
            setDisplay(value);
            return;
        }
        const tween = gsap.to(current.current, { n: value, duration: 0.5, ease: 'power3.out', onUpdate: () => setDisplay(current.current.n) });
        return () => {
            tween.kill();
        };
    }, [value]);
    return <span className="num">{format(display)}</span>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <div className="empty">
            <p>{children}</p>
            {action}
        </div>
    );
}

export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="kbd">{children}</kbd>;
}

/** Stagger a list's children in once (180 ms, 24 ms apart). Content stays visible without JS. */
export function useStaggerIn<T extends HTMLElement>(deps: unknown[] = []) {
    const ref = useRef<T>(null);
    useEffect(() => {
        if (!ref.current || prefersReducedMotion()) {
            return;
        }
        const items = Array.from(ref.current.children);
        const tween = gsap.from(items, { opacity: 0, y: 6, duration: 0.18, ease: 'power2.out', stagger: 0.024, clearProps: 'opacity,transform' });
        return () => {
            tween.revert();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return ref;
}
