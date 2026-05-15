import { minimize, toggleMaximize, closeWindow } from '../../lib/tauri';
import styles from './Titlebar.module.css';

export function Titlebar() {
  return (
    <div className={styles.titlebar} data-tauri-drag-region>
      <div className={styles.title} data-tauri-drag-region>
        Markdown Reader
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          onClick={minimize}
          aria-label="Minimize"
          title="最小化"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={toggleMaximize}
          aria-label="Maximize"
          title="最大化/还原"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.close}`}
          onClick={closeWindow}
          aria-label="Close"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M 0,0 L 10,10 M 10,0 L 0,10"
              stroke="currentColor"
              strokeWidth="1"
              fill="none"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
