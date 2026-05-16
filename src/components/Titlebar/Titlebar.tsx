import { minimize, toggleMaximize, closeWindow } from '../../lib/tauri';
import { useTheme } from '../ThemeProvider/useTheme';
import { nextMode } from '../ThemeProvider/themeCycle';
import { useEditMode } from '../EditModeProvider/useEditMode';
import { basename } from '../../lib/pathUtils';
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

interface TitlebarProps {
  /** Current document path. `null` when on EmptyState. Used to render
   *  the centered title (basename) + R-EDIT-5.3 dirty prefix.
   *  Optional so tests that mount Titlebar standalone keep working. */
  docPath?: string | null;
}

/**
 * Win11-style custom titlebar.
 *
 * v1.0 PR-A additions (R-EDIT-3.2, R-EDIT-5.3):
 *   - ✏️ / 👁 edit-mode toggle button to the LEFT of the theme button.
 *     Clicking it cycles the EditModeProvider's mode (silent-save
 *     applies when going edit → read with dirty buffer). Tooltip
 *     advertises the Ctrl+E shortcut.
 *   - The title text is no longer hard-coded "Markdown Reader". Now:
 *       (dirty ? '● ' : '') + basename(docPath ?? 'Markdown Reader')
 *     so the user has a constant visual signal that there are
 *     unsaved changes.
 */
export function Titlebar({ docPath }: TitlebarProps = {}) {
  const { mode, setMode } = useTheme();
  const { mode: editMode, toggleMode, dirty } = useEditMode();

  const handleThemeClick = () => {
    setMode(nextMode(mode));
  };

  const handleEditClick = () => {
    void toggleMode();
  };

  // Title computation. EmptyState has no doc → show app name. Dirty
  // mark renders only when both: doc is open AND buffer differs from
  // disk. The marker is a U+25CF BLACK CIRCLE — matches every common
  // editor's "modified" affordance (VS Code, Sublime, etc.).
  const baseTitle = docPath ? basename(docPath) : 'Markdown Reader';
  const titleText = dirty ? `● ${baseTitle}` : baseTitle;

  // Edit-mode tooltip + icon. When in edit mode the icon is an eye
  // (👁 → "click to view / read") and vice versa.
  const isEdit = editMode === 'edit';
  const editTooltip = isEdit
    ? '切换为阅读模式 (Ctrl+E)'
    : '切换为编辑模式 (Ctrl+E)';

  return (
    <div className={styles.titlebar} data-tauri-drag-region data-print-hide>
      <div className={styles.title} data-tauri-drag-region>
        {titleText}
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.btn} ${styles.editBtn}`}
          onClick={handleEditClick}
          aria-label={editTooltip}
          title={editTooltip}
          aria-pressed={isEdit}
        >
          <EditModeIcon isEdit={isEdit} />
        </button>
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
 * Edit/read mode glyph (R-EDIT-3.2).
 *
 * Read mode → pencil ✏️ (click to edit). Edit mode → eye (click to
 * preview-only). Both rendered as inline SVG so they pick up
 * currentColor and theme-flip correctly without an emoji font
 * dependency.
 */
function EditModeIcon({ isEdit }: { isEdit: boolean }) {
  if (isEdit) {
    // Eye glyph: outlined eye with a center dot. "Click to view-only".
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          d="M1.5 8s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8z"
        />
        <circle cx="8" cy="8" r="1.8" fill="currentColor" />
      </svg>
    );
  }
  // Pencil glyph: diagonal line + tip triangle. "Click to edit".
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" />
        <path d="M10.5 3.5l2 2" />
      </g>
    </svg>
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
