import { useEffect, useRef, type RefObject } from 'react';

/**
 * One-way scroll sync: editor cursor line → preview scroll (v1.0 PR-B,
 * R-EDIT-4.2/4.3).
 *
 * When the editor cursor moves to a new line, we scroll the preview so
 * the matching block aligns to the top of the preview's scroll area. The
 * sync is editor→preview ONLY (R-EDIT-4.2): scrolling the preview never
 * moves the editor, which avoids the feedback loop a bidirectional sync
 * would create.
 *
 * Mapping (R-EDIT-4.3):
 *   - The editor cursor line is relative to the full buffer; subtract
 *     `lineOffset` (frontmatter lines) to get the BODY line that the
 *     rehypeSourceLine stamps use.
 *   - Find the block whose `data-source-line` is the largest value ≤ the
 *     target body line ("closest preceding block"). This handles cursor
 *     positions inside elements that weren't stamped (code blocks,
 *     list-item children) by snapping to the nearest stamped ancestor
 *     block above.
 *
 * We align via manual `scrollTop` math rather than `scrollIntoView` so
 * the sync only ever touches the preview's own scroll container — no
 * surprise scrolling of the window or the titlebar.
 *
 * Debounced 50ms so a held arrow key / fast typing burst coalesces into
 * one scroll instead of one per keystroke (R-EDIT, Technical Notes).
 */

interface ScrollSyncOptions {
  /** Edit mode AND settings.editor.scrollSync. */
  enabled: boolean;
  /** Preview scroll container. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Article root to query `[data-source-line]` within. */
  articleRef: RefObject<HTMLElement | null>;
  /** 1-indexed editor cursor line (full-buffer), or null. */
  cursorLine: number | null;
  /** Frontmatter line count to subtract (0 when no frontmatter). */
  lineOffset: number;
}

export function useEditorScrollSync({
  enabled,
  scrollRef,
  articleRef,
  cursorLine,
  lineOffset,
}: ScrollSyncOptions): void {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || cursorLine == null) return;

    const run = () => {
      const scroller = scrollRef.current;
      const article = articleRef.current;
      if (!scroller || !article) return;

      const bodyLine = cursorLine - lineOffset;
      let target: HTMLElement | null = null;

      if (bodyLine <= 1) {
        // Cursor at/above the first body line → top of preview.
        scroller.scrollTo({ top: 0 });
        return;
      }

      const nodes = article.querySelectorAll<HTMLElement>('[data-source-line]');
      let bestLine = -1;
      for (const el of nodes) {
        const ln = Number(el.getAttribute('data-source-line'));
        if (!Number.isFinite(ln)) continue;
        if (ln <= bodyLine && ln > bestLine) {
          bestLine = ln;
          target = el;
        }
      }

      if (!target) {
        scroller.scrollTo({ top: 0 });
        return;
      }

      // Align the target block's top with the scroll container's top.
      const containerTop = scroller.getBoundingClientRect().top;
      const elTop = target.getBoundingClientRect().top;
      scroller.scrollTop += elTop - containerTop;
    };

    timerRef.current = window.setTimeout(run, 50);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, cursorLine, lineOffset, scrollRef, articleRef]);
}
