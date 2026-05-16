import { minimize, toggleMaximize, closeWindow } from '../../lib/tauri';
import { useTheme } from '../ThemeProvider/useTheme';
import { nextMode } from '../ThemeProvider/themeCycle';
import type { ThemeMode } from '../../lib/settings';
import styles from './Titlebar.module.css';

/** Per-mode glyph + Chinese tooltip text shown on the button. */
function tooltipFor(mode: ThemeMode): string {
  switch (mode) {
    case 'light':
      return '主题：浅色（点击切换为深色）';
    case 'dark':
      return '主题：深色（点击切换为跟随系统）';
    case 'system':
      return '主题：跟随系统（点击切换为浅色）';
  }
}

export function Titlebar() {
  const { mode, setMode } = useTheme();

  const handleThemeClick = () => {
    setMode(nextMode(mode));
  };

  return (
    <div className={styles.titlebar} data-tauri-drag-region>
      <div className={styles.title} data-tauri-drag-region>
        Markdown Reader
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.btn} ${styles.themeBtn}`}
          onClick={handleThemeClick}
          aria-label="切换主题"
          title={tooltipFor(mode)}
        >
          <ThemeIcon mode={mode} />
        </button>
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

/**
 * Per-mode icon: sun for light, moon for dark, ◐ half-disc for system.
 * Slightly smaller than the window-control glyphs so it visually reads
 * as "auxiliary" rather than competing with min/max/close. The path
 * data is purely decorative; we expose semantics via aria-label on the
 * parent button.
 */
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'light') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        {/* Sun: solid circle + 8 rays. */}
        <circle cx="8" cy="8" r="3" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <line x1="8" y1="1.5" x2="8" y2="3" />
          <line x1="8" y1="13" x2="8" y2="14.5" />
          <line x1="1.5" y1="8" x2="3" y2="8" />
          <line x1="13" y1="8" x2="14.5" y2="8" />
          <line x1="3.4" y1="3.4" x2="4.4" y2="4.4" />
          <line x1="11.6" y1="11.6" x2="12.6" y2="12.6" />
          <line x1="12.6" y1="3.4" x2="11.6" y2="4.4" />
          <line x1="4.4" y1="11.6" x2="3.4" y2="12.6" />
        </g>
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
        {/* Crescent moon — single path so currentColor fills cleanly. */}
        <path
          fill="currentColor"
          d="M6.5 1.5a6.5 6.5 0 1 0 8 8 5.5 5.5 0 0 1-8-8z"
        />
      </svg>
    );
  }
  // 'system' — half-shaded disc.
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path fill="currentColor" d="M8 2a6 6 0 0 1 0 12z" />
    </svg>
  );
}
