import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BookMarked, Bot, Copy, ExternalLink, FileInput, Link2, PenLine } from 'lucide-react';
import { ORIGIN_HINT, ORIGIN_LABEL } from '../lib/format';
import type { Origin } from '../api';

// ── Dialog ─────────────────────────────────────────────────────
export function Dialog({
  open,
  onClose,
  children,
  className = '',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

// ── Toasts & confirm ───────────────────────────────────────────
interface ToastItem { id: number; text: string; tone?: 'error'; action?: { label: string; run: () => void } }
interface ConfirmOpts { title: string; body?: ReactNode; confirm?: string; danger?: boolean }

interface UICtx {
  toast: (text: string, opts?: { tone?: 'error'; action?: ToastItem['action'] }) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  capture: { open: boolean; set: (v: boolean) => void };
  palette: { open: boolean; set: (v: boolean) => void };
  help: { open: boolean; set: (v: boolean) => void };
  lens: { open: boolean; set: (v: boolean) => void };
}
const Ctx = createContext<UICtx | null>(null);
export const useUI = () => useContext(Ctx)!;

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);

  const toast = useCallback<UICtx['toast']>((text, opts) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 6000 : 3200);
  }, []);
  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })), []);
  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  return (
    <Ctx.Provider
      value={{
        toast,
        confirm,
        capture: { open: captureOpen, set: setCaptureOpen },
        palette: { open: paletteOpen, set: setPaletteOpen },
        help: { open: helpOpen, set: setHelpOpen },
        lens: { open: lensOpen, set: setLensOpen },
      }}
    >
      {children}
      <Dialog open={!!confirmState} onClose={() => close(false)} labelledBy="confirm-title">
        {confirmState && (
          <>
            <div className="dialog-head">
              <h2 className="h2" id="confirm-title">{confirmState.title}</h2>
            </div>
            {confirmState.body && <div className="dialog-body dim">{confirmState.body}</div>}
            <div className="dialog-foot">
              <button className="btn ghost" onClick={() => close(false)}>Cancel</button>
              <button className={`btn ${confirmState.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>
                {confirmState.confirm ?? 'Confirm'}
              </button>
            </div>
          </>
        )}
      </Dialog>
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            {t.text}
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

// ── Small pieces ───────────────────────────────────────────────
const ORIGIN_ICON = { native: PenLine, external: BookMarked, imported: Copy, link: Link2, ai: Bot } as const;

export function OriginBadge({ origin, showNative = false }: { origin: Origin; showNative?: boolean }) {
  if (origin === 'native' && !showNative) return null;
  const Icon = ORIGIN_ICON[origin] ?? FileInput;
  return (
    <span className={`badge ${origin}`} title={ORIGIN_HINT[origin]}>
      <Icon /> {ORIGIN_LABEL[origin]}
    </span>
  );
}

export const WsDot = ({ color, title }: { color: string | null | undefined; title?: string }) => (
  <span className="ws-dot" style={{ background: color ?? 'var(--faint)' }} title={title} aria-hidden={!title} />
);

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="h2">{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function SafeExternal({ url, children }: { url: string; children?: ReactNode }) {
  const ok = /^https?:\/\//i.test(url);
  if (!ok) return <span>{children ?? url}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="row" style={{ gap: 6, display: 'inline-flex', color: 'var(--accent)', minWidth: 0 }}>
      <span className="truncate">{children ?? url.replace(/^https?:\/\//, '')}</span>
      <ExternalLink size={12} style={{ flex: 'none' }} />
    </a>
  );
}

/** Render FTS snippets: the server marks hits with \u0002…\u0003; we turn those into <mark> safely. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p.replace(/[\u0002\u0003]/g, '')}</span>,
      )}
    </>
  );
}
