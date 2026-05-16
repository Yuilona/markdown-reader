import { useStatusBar } from './StatusBarContext';
import styles from './StatusBar.module.css';

/**
 * Bottom-of-window status bar (R7.6, PR-8).
 *
 * Shows the URL of the currently-hovered link. When nothing is hovered,
 * the bar is empty (but still occupies its 24px row so the layout
 * doesn't jump as the user moves their mouse on/off links).
 *
 * Hidden during print via `data-print-hide` (R11.3).
 *
 * The text comes from `useStatusBar()`. The producer side (delegated
 * mouseover listener on the article) lives in `DocumentView.tsx`.
 */
export function StatusBar() {
  const { text } = useStatusBar();
  return (
    <div className={styles.bar} data-print-hide role="status" aria-live="off">
      <span className={styles.text} title={text ?? undefined}>
        {text ?? ' ' /* non-breaking space keeps the row tall when empty */}
      </span>
    </div>
  );
}
