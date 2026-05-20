import { useEffect, useRef, type RefObject } from 'react';

/**
 * Editor cursor → preview sync (v1.0, R-EDIT-4 + bidirectional line sync).
 *
 * When the editor cursor moves to a new line we locate the matching
 * preview block (via the `data-source-line` stamps from rehypeSourceLine)
 * and:
 *   - briefly flash-highlight it (`.source-line-flash`) so the eye can
 *     find the corresponding rendered line — this is the editor→preview
 *     half of the click-to-highlight feature, and runs whenever edit mode
 *     is active.
 *   - scroll it to the top of the preview, but ONLY when
 *     `settings.editor.scrollSync` is on.
 *
 * Editor→preview only (no reverse): the preview→editor direction is a
 * click handler in DocumentView that calls `jumpToEditorLine`.
 *
 * Mapping: the cursor line is full-buffer; subtract `lineOffset`
 * (frontmatter lines) to get the BODY line the stamps use, then take the
 * block whose `data-source-line` is the largest value ≤ the target.
 *
 * Debounced 50ms so a held arrow key / line-spanning edit coalesces.
 */

interface ScrollSyncOptions {
  /** Edit mode active (preview is the split right pane). */
  editActive: boolean;
  /** settings.editor.scrollSync — gates the scroll, not the flash. */
  scrollSync: boolean;
  /** Preview scroll container. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Article root to query `[data-source-line]` within. */
  articleRef: RefObject<HTMLElement | null>;
  /** 1-indexed editor cursor line (full-buffer), or null. */
  cursorLine: number | null;
  /** Frontmatter line count to subtract (0 when no frontmatter). */
  lineOffset: number;
}

/** Add the flash class, restarting the CSS animation if it's already
 *  present (remove → reflow → add), then strip it after the animation. */
function flashElement(el: HTMLElement): void {
  el.classList.remove('source-line-flash');
  void el.offsetWidth; // force reflow so the animation replays
  el.classList.add('source-line-flash');
  window.setTimeout(() => el.classList.remove('source-line-flash'), 900);
}

export function useEditorScrollSync({
  editActive,
  scrollSync,
  scrollRef,
  articleRef,
  cursorLine,
  lineOffset,
}: ScrollSyncOptions): void {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!editActive || cursorLine == null) return;

    const run = () => {
      const scroller = scrollRef.current;
      const article = articleRef.current;
      if (!scroller || !article) return;

      const bodyLine = cursorLine - lineOffset;
      if (bodyLine <= 1) {
        if (scrollSync) scroller.scrollTo({ top: 0 });
        return;
      }

      const nodes = article.querySelectorAll<HTMLElement>('[data-source-line]');
      let bestLine = -1;
      let target: HTMLElement | null = null;
      for (const el of nodes) {
        const ln = Number(el.getAttribute('data-source-line'));
        if (!Number.isFinite(ln)) continue;
        if (ln <= bodyLine && ln > bestLine) {
          bestLine = ln;
          target = el;
        }
      }
      if (!target) {
        if (scrollSync) scroller.scrollTo({ top: 0 });
        return;
      }

      if (scrollSync) {
        const containerTop = scroller.getBoundingClientRect().top;
        const elTop = target.getBoundingClientRect().top;
        scroller.scrollTop += elTop - containerTop;
      }
      flashElement(target);
    };

    timerRef.current = window.setTimeout(run, 50);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [editActive, scrollSync, cursorLine, lineOffset, scrollRef, articleRef]);
}
