import { useEffect, useRef, type RefObject } from 'react';

/**
 * Editor cursor → preview sync (v1.0, R-EDIT-4 + bidirectional line sync).
 *
 * When the editor cursor moves to a new line we locate the matching
 * preview block (via the `data-source-line` stamps from rehypeSourceLine)
 * and:
 *   - briefly flash-highlight it (`.source-line-flash`) so the eye can
 *     find the corresponding rendered line — the editor→preview half of
 *     the click-to-highlight feature; runs whenever edit mode is active.
 *   - scroll it into a comfortable position, but ONLY when
 *     `settings.editor.scrollSync` is on.
 *
 * Scroll positioning:
 *   - Short blocks are centered in the viewport.
 *   - Blocks TALLER than the viewport (long tables, big mermaid/KaTeX) are
 *     TOP-aligned with a small margin — centering their geometric middle
 *     would push the block's top off-screen (the old bug: "jumped too high /
 *     not visible").
 *   - Because mermaid/KaTeX lay out asynchronously, the target's measured
 *     position right after a cursor change can be stale. We re-apply the
 *     scroll on the next animation frame and once more shortly after, so the
 *     block settles into place after async render. All deferred passes are
 *     cancelled on cleanup so a newer cursor change wins.
 *
 * Echo suppression (`suppressRef`):
 *   A preview CLICK moves the editor cursor (preview→editor jump), which
 *   would re-trigger THIS effect and scroll the preview the user just
 *   clicked — jarring. DocumentView sets `suppressRef` right before such a
 *   jump; we consume it once and skip the scroll+flash for that change.
 *
 * Mapping: cursor line is full-buffer; subtract `lineOffset` (frontmatter
 * lines) to get the BODY line the stamps use, then take the block whose
 * `data-source-line` is the largest value ≤ the target. Debounced 50ms.
 */

interface ScrollSyncOptions {
  editActive: boolean;
  scrollSync: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  articleRef: RefObject<HTMLElement | null>;
  cursorLine: number | null;
  lineOffset: number;
  /** Set true by a preview-click jump so the resulting cursor change does
   *  NOT scroll/flash the preview back (consumed once). Mutable holder
   *  (we write `.current`), so not React's readonly `RefObject`. */
  suppressRef?: { current: boolean };
}

/** px gap left above a top-aligned tall block / above a centered block's
 *  clamp, so the target never kisses the very top edge. */
const TOP_MARGIN = 24;

export function useEditorScrollSync({
  editActive,
  scrollSync,
  scrollRef,
  articleRef,
  cursorLine,
  lineOffset,
  suppressRef,
}: ScrollSyncOptions): void {
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lateTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!editActive || cursorLine == null) return;

    // Add the flash class, restarting the animation if already present, then
    // strip it after the animation. A single shared timer is cancelled on the
    // next flash so an older flash's clear can't cut a newer one short.
    const flashElement = (el: HTMLElement) => {
      if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
      el.classList.remove('source-line-flash');
      void el.offsetWidth; // force reflow so the animation replays
      el.classList.add('source-line-flash');
      flashTimerRef.current = window.setTimeout(() => {
        el.classList.remove('source-line-flash');
        flashTimerRef.current = null;
      }, 2000);
    };

    // Scroll the target into a comfortable position (center, or top-align
    // when it's taller than the viewport). Recomputed each pass so async
    // layout (mermaid/KaTeX) settles correctly.
    const applyScroll = (scroller: HTMLElement, target: HTMLElement) => {
      const containerRect = scroller.getBoundingClientRect();
      const elRect = target.getBoundingClientRect();
      const fitsCentered = elRect.height < containerRect.height - TOP_MARGIN;
      const delta = fitsCentered
        ? elRect.top - containerRect.top - (containerRect.height / 2 - elRect.height / 2)
        : elRect.top - containerRect.top - TOP_MARGIN; // tall → top-align
      scroller.scrollTop += delta;
    };

    const run = () => {
      // Consume a one-shot suppression (preview-click echo): skip scroll AND
      // flash so clicking a preview block doesn't scroll the preview back.
      if (suppressRef?.current) {
        suppressRef.current = false;
        return;
      }

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
        applyScroll(scroller, target);
        // Re-correct after async layout (mermaid/KaTeX). Both deferred passes
        // are cancelled on cleanup if a newer cursor change supersedes.
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          if (target) applyScroll(scroller, target);
        });
        lateTimerRef.current = window.setTimeout(() => {
          lateTimerRef.current = null;
          if (target) applyScroll(scroller, target);
        }, 160);
      }
      flashElement(target);
    };

    timerRef.current = window.setTimeout(run, 50);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (lateTimerRef.current !== null) clearTimeout(lateTimerRef.current);
      timerRef.current = rafRef.current = lateTimerRef.current = null;
    };
  }, [editActive, scrollSync, cursorLine, lineOffset, scrollRef, articleRef, suppressRef]);
}
