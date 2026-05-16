import { useEffect, useState, type ReactNode } from 'react';
import styles from './SplitView.module.css';

/**
 * Adaptive split-view container (v1.0 PR-A, R-EDIT-2.1).
 *
 * Wraps two children — typically `<editor>` and `<preview>` — and lays
 * them out either side-by-side or stacked, depending on viewport width.
 *
 * Layout rule (R-EDIT-2.1):
 *   - viewport width > 900px → horizontal (left = editor, right = preview)
 *   - viewport width ≤ 900px → vertical (top = editor, bottom = preview)
 *
 * The 900px threshold is the PRD's recommendation. We re-detect the
 * orientation on `resize` so dragging the window across the threshold
 * flips the layout live.
 *
 * Split ratio (R-EDIT-2.3):
 *   PR-A pins the ratio at 0.5 (50/50). The `ratio` prop is accepted
 *   for API completeness but is NOT yet wired to a drag handle —
 *   PR-B adds the draggable gutter + persistence.
 *
 * Minimum pane size (R-EDIT-2.2):
 *   Each pane is `flex: 1 1 50%` with `min-width: 200px` (horizontal)
 *   or `min-height: 200px` (vertical). The minimums prevent either
 *   pane from collapsing to invisibility on narrow viewports.
 *
 * The gutter is a 4px static divider in PR-A (no pointer events). PR-B
 * promotes it to a drag handle with cursor + onPointerDown.
 */

interface SplitViewProps {
  /** Pane shown left (horizontal) or top (vertical). PR-A: the editor. */
  left: ReactNode;
  /** Pane shown right (horizontal) or bottom (vertical). PR-A: the preview. */
  right: ReactNode;
  /** Split fraction (0..1). PR-A ignores this and uses 0.5 — kept in
   *  the API so PR-B's drag splitter doesn't need a prop-shape change. */
  ratio?: number;
}

/** PRD threshold for horizontal vs vertical layout (R-EDIT-2.1). */
const HORIZONTAL_BREAKPOINT_PX = 900;

/** Subscribe to a `(max-width: ...)` media query and return its
 *  current match state. Cheap shared helper — extracted in case PR-B
 *  needs the same primitive for a future "compact mode" layout. */
function useMatchMedia(query: string): boolean {
  // Initial value: synchronously read matchMedia on mount via a lazy
  // initializer so SSR-safe (matchMedia would throw at module load on
  // an SSR target — though Tauri doesn't SSR, the guard is cheap).
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Re-sync to the CURRENT value on subscribe (mounted after a resize
    // through the breakpoint would otherwise keep the stale initial).
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function SplitView({ left, right }: SplitViewProps) {
  // True when the viewport is narrow → stack panes vertically.
  const isNarrow = useMatchMedia(`(max-width: ${HORIZONTAL_BREAKPOINT_PX}px)`);
  const orientationClass = isNarrow ? styles.vertical : styles.horizontal;

  return (
    <div className={`${styles.split} ${orientationClass}`}>
      <div className={styles.pane}>{left}</div>
      <div className={styles.gutter} aria-hidden="true" />
      <div className={styles.pane}>{right}</div>
    </div>
  );
}
