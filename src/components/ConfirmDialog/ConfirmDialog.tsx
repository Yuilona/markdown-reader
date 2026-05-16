import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './ConfirmDialog.module.css';

/**
 * Imperative confirm-style modal (v1.0 PR-A, R-EDIT-5.4).
 *
 * Used by the dirty-guard flow to ask three-button questions like:
 *   - "有未保存的修改" [放弃] [取消] [保存并继续]
 *   - "外部修改：xxx.md 已被其他程序修改" [重载（丢弃修改）] [保留我的修改]
 *
 * Tauri's native `ask()` only supports a two-button yes/no. Wrapping a
 * pair of asks would feel kludgy (the user would see two prompts for
 * one decision), so we build a small React modal and call it via the
 * `useConfirm()` hook which exposes an imperative API:
 *
 *   const confirm = useConfirm();
 *   const choice = await confirm({
 *     title: '有未保存的修改',
 *     message: '...',
 *     buttons: [
 *       { value: 'discard', label: '放弃' },
 *       { value: 'cancel', label: '取消', variant: 'secondary' },
 *       { value: 'save', label: '保存并继续', variant: 'primary' },
 *     ],
 *   });
 *
 * `confirm()` returns a Promise that resolves to the `value` of the
 * clicked button, or to `'cancel'` (or whatever the `cancelValue` is)
 * if the user presses Esc / clicks the backdrop / dismisses.
 *
 * Rendering:
 *   - Portal'd to document.body so it floats above the entire app
 *     chrome (titlebar, status bar, lightbox, etc.) — z-index sits
 *     above every other overlay in the app (10000).
 *   - Focus is trapped softly: first render auto-focuses the primary
 *     button. We don't enforce a full focus trap because the modal is
 *     short-lived and the primary use case is keyboard-driven (Enter
 *     to accept, Esc to cancel).
 */

export interface ConfirmButton<V extends string = string> {
  /** Value resolved when this button is clicked. */
  value: V;
  /** Visible label. */
  label: string;
  /** Visual variant. `primary` = accent fill; `danger` = red; default = subtle. */
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface ConfirmOptions<V extends string = string> {
  title?: string;
  message?: ReactNode;
  buttons: ConfirmButton<V>[];
  /** Value returned when the user presses Esc or clicks the backdrop.
   *  Default: 'cancel' (which may or may not be one of the buttons —
   *  the caller is responsible for handling it). */
  cancelValue?: V;
}

interface ConfirmDialogProps<V extends string = string> {
  open: boolean;
  options: ConfirmOptions<V> | null;
  onClose: (value: V) => void;
}

export function ConfirmDialog<V extends string = string>({
  open,
  options,
  onClose,
}: ConfirmDialogProps<V>) {
  const primaryBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the primary button (or the last button if no primary) on
  // open. The autoFocus prop is unreliable in portals — manual focus
  // gives us deterministic behavior.
  useEffect(() => {
    if (open && primaryBtnRef.current) {
      // requestAnimationFrame so the DOM has settled (portal mount
      // can race with the focus call in StrictMode dev double-mount).
      const id = requestAnimationFrame(() => {
        primaryBtnRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // Esc handling: close with cancelValue. Keydown is registered on
  // window so it works even when the focus is inside one of our
  // buttons (which it always is, due to the auto-focus above).
  useEffect(() => {
    if (!open || !options) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose((options.cancelValue ?? 'cancel') as V);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, options, onClose]);

  if (!open || !options) return null;

  // Identify the "primary" button for auto-focus + Enter-affordance.
  // Prefer explicit primary; fall back to the LAST button (the
  // rightmost in our layout, which by convention is the affirmative
  // action).
  const primaryIdx = (() => {
    const idx = options.buttons.findIndex((b) => b.variant === 'primary');
    if (idx >= 0) return idx;
    return options.buttons.length - 1;
  })();

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close when the click hits the backdrop itself, not the
    // dialog body. (Clicks bubble; without this guard a click inside
    // the dialog would trigger the cancel path.)
    if (e.target === e.currentTarget) {
      onClose((options.cancelValue ?? 'cancel') as V);
    }
  };

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={options.title ? 'confirmDialogTitle' : undefined}
    >
      <div className={styles.dialog}>
        {options.title && (
          <div className={styles.title} id="confirmDialogTitle">
            {options.title}
          </div>
        )}
        {options.message && <div className={styles.message}>{options.message}</div>}
        <div className={styles.buttons}>
          {options.buttons.map((btn, idx) => {
            const variantClass =
              btn.variant === 'primary'
                ? styles.btnPrimary
                : btn.variant === 'danger'
                  ? styles.btnDanger
                  : styles.btnSecondary;
            return (
              <button
                key={btn.value}
                type="button"
                ref={idx === primaryIdx ? primaryBtnRef : undefined}
                className={`${styles.btn} ${variantClass}`}
                onClick={() => onClose(btn.value)}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
