import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- botones
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700 hover:border-brand-700 hover:shadow-lift',
  secondary: 'bg-white text-navy-900 border-slate-300 hover:border-slate-500 hover:shadow-lift',
  danger: 'bg-white text-red-700 border-red-200 hover:bg-red-50 hover:border-red-600',
  ghost: 'bg-transparent text-navy-700 border-transparent hover:bg-navy-50',
};

export function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition duration-150 ease-out',
        'hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none',
        size === 'sm' ? 'min-h-[34px] px-3 text-[13px]' : 'min-h-[42px] px-4 text-sm',
        VARIANT[variant],
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- campos
const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-[15px] text-navy-950 transition placeholder:text-slate-400 ' +
  'hover:border-slate-400 focus:border-navy-600 focus:outline-none focus:ring-4 focus:ring-navy-600/15 disabled:bg-slate-50 disabled:text-slate-500';

export function Field({ label, hint, error, required, children, htmlFor, className }:
  { label: string; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-navy-900">
        {label}
        {required && <span className="ml-0.5 text-brand-600">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[13px] text-slate-500">{hint}</p>}
      {error && <p className="text-[13px] font-semibold text-red-700">{error}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(inputClass, 'min-h-[44px]', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(inputClass, 'min-h-[96px] resize-y', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(inputClass, 'min-h-[44px] cursor-pointer pr-9', className)}>
      {children}
    </select>
  );
}

// ---------------------------------------------------------------- superficies
export function Card({ className, children, flush }: { className?: string; children: ReactNode; flush?: boolean }) {
  return <section className={cx('rounded-2xl border border-slate-200 bg-white shadow-card', flush ? 'overflow-hidden' : 'p-5 sm:p-6', className)}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="mb-2 flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.16em] text-brand-600">
          <span className="h-0.5 w-4 rounded bg-brand-600" aria-hidden />
          {eyebrow}
        </p>
        <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tight text-navy-950 sm:text-[30px]">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-[15px] text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </header>
  );
}

const BADGE: Record<string, string> = {
  green: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  navy: 'bg-navy-50 text-navy-700 ring-navy-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
};
export function Badge({ tone = 'gray', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', BADGE[tone])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

const ALERT = {
  info: { cls: 'border-navy-100 bg-navy-50 text-navy-800', Icon: Info },
  success: { cls: 'border-brand-100 bg-brand-50 text-brand-700', Icon: CheckCircle2 },
  warning: { cls: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle },
  error: { cls: 'border-red-200 bg-red-50 text-red-800', Icon: XCircle },
};
export function Alert({ tone = 'info', title, children, className }: { tone?: keyof typeof ALERT; title?: string; children?: ReactNode; className?: string }) {
  const { cls, Icon } = ALERT[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border px-4 py-3 text-[14.5px]', cls, className)}>
      <Icon className="mt-0.5 h-5 w-5 flex-none" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-slate-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <p className="font-display text-lg font-bold text-navy-900">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-slate-600">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- modal
// Pila de ventanas abiertas: Escape cierra solo la de arriba.
const modalStack: symbol[] = [];

export function Modal({ open, title, onClose, children, footer, wide }:
  { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const me = Symbol('modal');
    modalStack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === me) onClose();
    };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(me), 1);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/45 p-0 backdrop-blur-[3px] sm:px-4 sm:py-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={cx('flex min-h-full w-full flex-col bg-white shadow-2xl sm:min-h-0 sm:rounded-2xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-xl')}>
        <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-4">
          <h2 id={titleId} className="mr-auto font-display text-xl font-extrabold text-navy-950">{title}</h2>
          <button data-close onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-navy-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- avisos flotantes
type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-[min(420px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('animate-[toast_.25s_ease-out] rounded-xl border-l-4 bg-navy-900 px-4 py-3 text-sm text-white shadow-2xl',
            t.tone === 'success' ? 'border-brand-500' : t.tone === 'error' ? 'border-red-500' : 'border-slate-400')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
