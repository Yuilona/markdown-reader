import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { getSettings, updateSettings } from '../../lib/settingsStore';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import styles from './SplitView.module.css';

/**
 * Adaptive split-view container (v1.0 PR-A layout, PR-B drag + persist).
 *
 * Layout (R-EDIT-2.1):
 *   - viewport > 900px → horizontal (left = editor, right = preview)
 *   - viewport ≤ 900px → vertical (top = editor, bottom = preview)
 *
 * Drag splitter (R-EDIT-2.2/2.3):
 *   The gutter is a pointer-captured drag handle. Dragging recomputes
 *   the ratio along the active axis and clamps it so each pane keeps at
 *   least MIN_PANE_PX AND the ratio stays in the persisted 0.2..0.8
 *   band. The ratio is loaded from settings.splitRatio on mount and
 *   written back on pointer-up (one write per drag, not per move).
 *
 * The flex-basis percentage is applied to the FIRST pane along the main
 * axis; flex-basis is main-axis-relative, so the same value works for
 * both row and column orientations without branching.
 */

interface SplitViewProps {
  /** Pane shown left (horizontal) or top (vertical). The editor. */
  left: ReactNode;
  /** Pane shown right (horizontal) or bottom (vertical). The preview. */
  right: ReactNode;
}

/** PRD threshold for horizontal vs vertical layout (R-EDIT-2.1). */
const HORIZONTAL_BREAKPOINT_PX = 900;
/** Minimum pixels per pane (R-EDIT-2.2). */
const MIN_PANE_PX = 200;
/** Persisted ratio band (R-EDIT-2.3). */
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Clamp `ratio` so both panes respect MIN_PANE_PX given the total
 *  `size` along the active axis, AND stay within the persisted band. */
function clampRatio(ratio: number, size: number): number {
  let lo = MIN_RATIO;
  let hi = MAX_RATIO;
  if (size > 0) {
    // Pixel floor for each pane, expressed as a ratio.
    lo = Math.max(lo, MIN_PANE_PX / size);
    hi = Math.min(hi, 1 - MIN_PANE_PX / size);
  }
  // Degenerate viewport (too small for both minimums): fall back to 0.5.
  if (lo > hi) return 0.5;
  return Math.max(lo, Math.min(hi, ratio));
}

export function SplitView({ left, right }: SplitViewProps) {
  const isNarrow = useMatchMedia(`(max-width: ${HORIZONTAL_BREAKPOINT_PX}px)`);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number>(DEFAULT_SETTINGS.splitRatio);
  const [dragging, setDragging] = useState(false);

  // Load the persisted ratio once on mount.
  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s) => {
      if (!cancelled) setRatio(s.splitRatio);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const next = isNarrow
        ? (e.clientY - rect.top) / rect.height
        : (e.clientX - rect.left) / rect.width;
      const size = isNarrow ? rect.height : rect.width;
      setRatio(clampRatio(next, size));
    },
    [dragging, isNarrow],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDragging(false);
      // Persist the committed ratio (one write per drag).
      void updateSettings({ splitRatio: ratio });
    },
    [dragging, ratio],
  );

  const orientationClass = isNarrow ? styles.vertical : styles.horizontal;
  // flex-basis on the first pane drives the split; the second pane fills
  // the rest. Disable flex-grow/shrink on the first pane so its basis is
  // authoritative.
  const firstPaneStyle: CSSProperties = {
    flex: `0 0 calc(${(ratio * 100).toFixed(3)}% - 2px)`,
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.split} ${orientationClass} ${dragging ? styles.dragging : ''}`}
    >
      <div className={styles.pane} style={firstPaneStyle}>
        {left}
      </div>
      <div
        className={styles.gutter}
        role="separator"
        aria-orientation={isNarrow ? 'horizontal' : 'vertical'}
        aria-label="拖动调整编辑/预览比例"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <div className={styles.pane}>{right}</div>
    </div>
  );
}
