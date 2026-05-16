import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ToastContainer } from './ToastContainer';

/**
 * Toast notification system (R12.5, R12.8, PR-8).
 *
 * Replaces the PR-5a "DropErrorBanner" with a real stack:
 *   - Multiple toasts can coexist (max MAX_VISIBLE).
 *   - Info / Success auto-dismiss; Error is sticky by default.
 *   - Each toast can carry `details` (a string the user expands via a
 *     small "详情" disclosure inside the toast card) — for showing the
 *     full Error.stack alongside the friendly one-liner per R12.8.
 *
 * API:
 *   const toast = useToast();
 *   const id = toast.show('已复制', { variant: 'success' });
 *   toast.show('复制失败', { variant: 'error', details: err.message });
 *   toast.dismiss(id);
 *   toast.clear();
 *
 * Variant defaults:
 *   - info     → 3000ms auto-dismiss
 *   - success  → 2000ms auto-dismiss
 *   - error    → no auto-dismiss (until user clicks ✕) — set `duration`
 *                explicitly to override.
 *
 * Caller can pass `duration: 0` to make any variant sticky, or any
 * positive number of ms to override the default.
 *
 * Stack management:
 *   When pushing a toast that would exceed MAX_VISIBLE, the OLDEST
 *   non-error toast is dropped to make room. Errors are sticky in BOTH
 *   the "no auto-dismiss" sense AND the "won't be evicted" sense — the
 *   user must explicitly dismiss them. This matches the PRD intent:
 *   errors are the message users need to act on.
 */

export type ToastVariant = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Optional extra details (e.g. error stack). Surface via a "详情"
   *  disclosure inside the toast card. */
  details?: string;
  /** When was this toast created (Date.now() ms). Used to drop the
   *  oldest non-error when the stack overflows. */
  createdAt: number;
  /** Effective duration in ms — 0 means sticky. */
  duration: number;
}

export interface ShowToastOptions {
  variant?: ToastVariant;
  details?: string;
  /** ms before auto-dismiss. 0 = sticky. When undefined, variant defaults
   *  apply (info: 3000, success: 2000, error: 0). */
  duration?: number;
}

export interface ToastContextValue {
  show: (message: string, opts?: ShowToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
export { ToastContext };

/** Maximum number of toasts visible at once. Excess pushes evict the
 *  oldest non-error toast (errors are sticky / un-evictable). */
const MAX_VISIBLE = 5;

/** Default auto-dismiss duration per variant (ms). 0 means sticky. */
const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  info: 3000,
  success: 2000,
  error: 0,
};

/** Module-scoped monotonic id counter so two toasts can't share an id
 *  even across StrictMode double-effects. */
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track auto-dismiss timers per toast id so we can cancel on early
  // dismiss / unmount. setTimeout returns `number` in the browser.
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    // Clear any scheduled auto-dismiss for this id.
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = useCallback(() => {
    // Cancel all timers; an in-flight auto-dismiss after clear() would
    // produce a confusing flash.
    for (const timer of timersRef.current.values()) {
      window.clearTimeout(timer);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const show = useCallback(
    (message: string, opts: ShowToastOptions = {}): number => {
      const variant = opts.variant ?? 'info';
      const duration = opts.duration ?? DEFAULT_DURATIONS[variant];
      const id = nextId++;
      const toast: Toast = {
        id,
        message,
        variant,
        details: opts.details,
        createdAt: Date.now(),
        duration,
      };

      setToasts((prev) => {
        let next = [...prev, toast];
        // Stack management: if we'd exceed MAX_VISIBLE, drop the oldest
        // non-error toast. Errors are sticky.
        while (next.length > MAX_VISIBLE) {
          const oldestNonErrorIdx = next.findIndex((t) => t.variant !== 'error');
          if (oldestNonErrorIdx === -1) {
            // Everything in the stack is an error; drop the OLDEST one
            // anyway. (Better than silently swallowing the newest error.)
            const dropped = next[0];
            next = next.slice(1);
            const timer = timersRef.current.get(dropped.id);
            if (timer !== undefined) {
              window.clearTimeout(timer);
              timersRef.current.delete(dropped.id);
            }
          } else {
            const dropped = next[oldestNonErrorIdx];
            next.splice(oldestNonErrorIdx, 1);
            const timer = timersRef.current.get(dropped.id);
            if (timer !== undefined) {
              window.clearTimeout(timer);
              timersRef.current.delete(dropped.id);
            }
          }
        }
        return next;
      });

      // Schedule auto-dismiss when duration > 0.
      if (duration > 0) {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(id);
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [],
  );

  // Cleanup all timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) {
        window.clearTimeout(t);
      }
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ show, dismiss, clear }),
    [show, dismiss, clear],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
