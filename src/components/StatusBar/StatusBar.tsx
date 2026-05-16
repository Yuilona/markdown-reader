import { useStatusBar } from './StatusBarContext';
import { useEditMode } from '../EditModeProvider/useEditMode';
import styles from './StatusBar.module.css';

/**
 * Bottom-of-window status bar (R7.6, PR-8).
 *
 * Layout:
 *   - LEFT cell: hover URL (PR-8) — empty when nothing hovered.
 *   - RIGHT cell (v1.0 PR-A, R-EDIT-2.6, R-EDIT-5.3): editor info,
 *     shown only when in edit mode. Format:
 *         行 N:M · K 字 · ●未保存 / ✓已保存
 *
 * The right cell is mounted only when `mode === 'edit'` to keep the
 * read-mode look unchanged (R7.6 read-mode behavior).
 *
 * Hidden during print via `data-print-hide` (R11.3).
 *
 * The hover-URL text comes from `useStatusBar()`. The editor info
 * (cursor + word count + dirty) comes from `useEditMode()`.
 */
export function StatusBar() {
  const { text } = useStatusBar();
  const { mode, cursor, wordCount, dirty } = useEditMode();
  const showEditorCell = mode === 'edit';

  return (
    <div className={styles.bar} data-print-hide role="status" aria-live="off">
      <span className={styles.text} title={text ?? undefined}>
        {text ?? ' ' /* non-breaking space keeps the row tall when empty */}
      </span>
      {showEditorCell && (
        <span className={styles.editorCell} aria-label="编辑器状态">
          {cursor && (
            <>
              <span className={styles.cell}>
                行 {cursor.line}:{cursor.col}
              </span>
              <span className={styles.cellSep}>·</span>
            </>
          )}
          <span className={styles.cell}>{wordCount} 字</span>
          <span className={styles.cellSep}>·</span>
          <span
            className={`${styles.cell} ${dirty ? styles.cellDirty : styles.cellClean}`}
          >
            {dirty ? '● 未保存' : '✓ 已保存'}
          </span>
        </span>
      )}
    </div>
  );
}
