import { openFileDialog, type LoadedDocument } from '../../lib/tauri';
import { RecentList } from './RecentList';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  /** Called with the loaded document when the user picks a file via dialog. */
  onOpen: (doc: LoadedDocument) => void;
  /**
   * Called when the user clicks a recent-list entry. App.tsx funnels this
   * through `setDocFromPath` so recent-list bookkeeping happens centrally.
   */
  onPickRecent: (path: string) => void;
  /**
   * True when a file is currently being dragged over the window (driven
   * by App.tsx's useDragDrop hook — see PR-5a brief §1). EmptyState
   * mirrors it with a visual outline. We no longer wire HTML5 drag events
   * here because Tauri 2 intercepts native drops before the DOM sees them.
   */
  isDragOver: boolean;
}

export function EmptyState({ onOpen, onPickRecent, isDragOver }: EmptyStateProps) {
  const handleOpen = async () => {
    const doc = await openFileDialog();
    if (doc) onOpen(doc);
  };

  return (
    <div className={`${styles.container} ${isDragOver ? styles.dragOver : ''}`}>
      <div className={styles.content}>
        <div className={styles.logo}>M</div>
        <p className={styles.hint}>拖拽 .md 文件到此处</p>
        <p className={styles.hintSub}>或</p>
        <button type="button" className={styles.openBtn} onClick={handleOpen}>
          打开文件 (Ctrl+O)
        </button>
        <RecentList onPick={onPickRecent} />
      </div>
    </div>
  );
}
