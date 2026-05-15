import { useState } from 'react';
import { openFileDialog, type LoadedDocument } from '../../lib/tauri';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  /** Called with the loaded document when the user picks a file. */
  onOpen: (doc: LoadedDocument) => void;
}

export function EmptyState({ onOpen }: EmptyStateProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // PR-1: visual-only drag-over feedback. Real drop handling is wired in PR-5.
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    // Real drop handling deferred to PR-5.
  };

  const handleOpen = async () => {
    const doc = await openFileDialog();
    if (doc) onOpen(doc);
  };

  return (
    <div
      className={`${styles.container} ${isDragOver ? styles.dragOver : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.content}>
        <div className={styles.logo}>M</div>
        <p className={styles.hint}>拖拽 .md 文件到此处</p>
        <p className={styles.hintSub}>或</p>
        <button type="button" className={styles.openBtn} onClick={handleOpen}>
          打开文件 (Ctrl+O)
        </button>
        <div className={styles.recent}>
          <p className={styles.recentTitle}>最近文件</p>
          <p className={styles.recentEmpty}>暂无最近文件</p>
        </div>
      </div>
    </div>
  );
}
