import { useState } from 'react';
import { createPortal } from 'react-dom';

import type { Toast } from './ToastProvider';
import styles from './Toast.module.css';

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/**
 * Portal-rendered overlay that paints all live toasts at the bottom-
 * center of the viewport. Stack grows upward (newest at the bottom),
 * so the latest message lands closest to the user's focal point.
 *
 * Portal target: document.body, so toasts always sit above the rest of
 * the chrome regardless of where ToastProvider is mounted in the tree.
 *
 * The container itself has `data-print-hide` so the @media print rule
 * in `styles/print.css` hides the whole stack — the user printing a
 * document does not want their last "已复制" floating in the page corner.
 */
export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  // Render nothing — including the wrapper div — when there's nothing
  // to show, so a stray empty `<div>` doesn't intercept clicks at the
  // bottom of the viewport.
  if (toasts.length === 0) return null;

  return createPortal(
    <div className={styles.container} data-print-hide aria-live="polite">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

interface ToastCardProps {
  toast: Toast;
  onDismiss: (id: number) => void;
}

function ToastCard({ toast, onDismiss }: ToastCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // A11y semantics: errors should be announced as alerts (interrupting),
  // info/success use the polite "status" role.
  const role = toast.variant === 'error' ? 'alert' : 'status';
  const ariaLive = toast.variant === 'error' ? 'assertive' : 'polite';

  const variantClass =
    toast.variant === 'error'
      ? styles.cardError
      : toast.variant === 'success'
        ? styles.cardSuccess
        : styles.cardInfo;

  return (
    <div
      className={`${styles.card} ${variantClass}`}
      role={role}
      aria-live={ariaLive}
    >
      <div className={styles.cardMain}>
        <span className={styles.message}>{toast.message}</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => onDismiss(toast.id)}
          aria-label="关闭"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M 1,1 L 9,9 M 9,1 L 1,9"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {toast.details && (
        <div className={styles.detailsRow}>
          <button
            type="button"
            className={styles.detailsToggle}
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? '收起详情' : '详情'}
          </button>
          {detailsOpen && (
            <pre className={styles.detailsBody}>{toast.details}</pre>
          )}
        </div>
      )}
    </div>
  );
}
