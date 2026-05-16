import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  createElement,
  type ReactNode,
} from 'react';

import { ConfirmDialog, type ConfirmOptions } from './ConfirmDialog';

/**
 * Imperative confirm hook (v1.0 PR-A, R-EDIT-5.4).
 *
 * `confirm(opts)` returns a Promise that resolves to the value of the
 * clicked button (or `opts.cancelValue ?? 'cancel'` on dismiss).
 *
 * Implementation:
 *   - The provider holds a stack of pending confirmations (only one is
 *     shown at a time — if the dirty-guard fires while the conflict
 *     dialog is open, the new request just queues until the user
 *     resolves the first).
 *   - Each pending entry carries the options + a resolver. When the
 *     ConfirmDialog calls `onClose(value)`, we look up the head of the
 *     queue, resolve its promise with the value, and pop.
 *
 * The stack-based approach beats a "show the LATEST" approach because
 * it preserves causality — if the user starts a save flow and the
 * watcher fires mid-flow, both dialogs ought to be honored.
 */

type ConfirmFn = <V extends string = string>(opts: ConfirmOptions<V>) => Promise<V>;

interface ConfirmContextValue {
  confirm: ConfirmFn;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm {
  id: number;
  options: ConfirmOptions<string>;
  resolve: (value: string) => void;
}

let nextId = 1;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingConfirm[]>([]);
  // The queue ref keeps a live snapshot for the close handler — using
  // the state directly would close over the value at the time the
  // function was created, not the time it's called.
  const queueRef = useRef<PendingConfirm[]>([]);
  queueRef.current = queue;

  const confirm = useCallback<ConfirmFn>(<V extends string>(opts: ConfirmOptions<V>): Promise<V> => {
    return new Promise<V>((resolve) => {
      const id = nextId++;
      const entry: PendingConfirm = {
        id,
        // The cast is safe — we erase the generic to allow a heterogeneous
        // queue; the resolver casts back when called.
        options: opts as unknown as ConfirmOptions<string>,
        resolve: (value: string) => resolve(value as V),
      };
      setQueue((prev) => [...prev, entry]);
    });
  }, []);

  // When the dialog closes, resolve the head of the queue and pop it.
  const handleClose = useCallback((value: string) => {
    const head = queueRef.current[0];
    if (!head) return;
    head.resolve(value);
    setQueue((prev) => prev.slice(1));
  }, []);

  const head = queue[0] ?? null;

  const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  // Use createElement (not JSX) so this hook file is .ts-clean — keeps
  // the file extension simple and avoids requiring tsconfig jsx config
  // ambiguity for non-component files.
  return createElement(
    ConfirmContext.Provider,
    { value },
    children,
    createElement(ConfirmDialog, {
      open: head !== null,
      options: head?.options ?? null,
      onClose: handleClose,
    }),
  );
}

/**
 * Hook for posting imperative confirmations. Must be called from
 * inside a `<ConfirmProvider>`. Returns the `confirm` function itself
 * (not a value object) — call sites don't need anything else.
 *
 * Falls back to a `window.confirm`-based shim when no provider is
 * mounted: useful in tests that omit the provider, and keeps a sane
 * default in case the provider ever moves out of the App tree.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (ctx) return ctx.confirm;
  return windowConfirmShim;
}

const windowConfirmShim: ConfirmFn = <V extends string>(opts: ConfirmOptions<V>): Promise<V> => {
  // Best-effort shim: concatenate title + message + a button-letter
  // hint and route through the browser's native confirm. The user can
  // see only "OK / Cancel" so the shim resolves to either the primary
  // button or the cancel value — three-button choices degrade.
  const text = [opts.title, typeof opts.message === 'string' ? opts.message : '']
    .filter(Boolean)
    .join('\n\n');
  const ok = window.confirm(text);
  const primary = opts.buttons.find((b) => b.variant === 'primary') ?? opts.buttons[opts.buttons.length - 1];
  const cancel = opts.cancelValue ?? ('cancel' as V);
  return Promise.resolve(ok ? (primary?.value as V) ?? cancel : cancel);
};
