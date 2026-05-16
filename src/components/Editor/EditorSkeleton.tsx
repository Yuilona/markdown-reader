import styles from './CodeMirrorEditor.module.css';

/**
 * Suspense fallback shown while the lazy CM6 chunk is downloading
 * (v1.0 PR-A, R-EDIT-1.2).
 *
 * On a typical install the chunk lands in <100ms from local disk so
 * this skeleton is briefly visible the FIRST time the user toggles
 * edit mode in a session. Subsequent toggles use the cached chunk and
 * the skeleton doesn't paint at all.
 *
 * Visual: a soft "Loading editor..." cell that matches the editor's
 * eventual frame. No spinner — CM6 loads fast enough that animation
 * would be more distracting than helpful.
 */
export function EditorSkeleton() {
  return (
    <div className={styles.editor} role="status" aria-label="编辑器加载中">
      <div
        style={{
          flex: '1 1 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-muted)',
          fontSize: 13,
        }}
      >
        编辑器加载中…
      </div>
    </div>
  );
}
