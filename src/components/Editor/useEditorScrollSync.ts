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
 *   - The block's TOP is aligned to a fixed anchor ~1/4 down the viewport,
 *     for EVERY block regardless of height. This makes the landing position
 *     consistent (centering the block's MIDDLE instead made tall vs short
 *     blocks land at different spots). Near the very top/bottom of the doc
 *     the scroll still clamps to bounds, so those edge blocks can't reach
 *     the anchor — unavoidable.
 *   - A single scroll pass: clicking the editor only moves the cursor, it
 *     does NOT re-render the preview, so mermaid/KaTeX are already laid out
 *     and the measurement is stable. (An earlier multi-pass rAF/timeout
 *     re-correction caused a visible two-step "scroll into view, then jump
 *     to the final spot" and was removed.)
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
  /** Total BODY line count (frontmatter-stripped). Lets the LAST stamped
   *  block still interpolate (its span = bestLine..totalBodyLines) instead
   *  of falling back to top-align — which left deep clicks in a long final
   *  block off-screen. */
  totalBodyLines?: number;
  /** Set true by a preview-click jump so the resulting cursor change does
   *  NOT scroll/flash the preview back (consumed once). Mutable holder
   *  (we write `.current`), so not React's readonly `RefObject`. */
  suppressRef?: { current: boolean };
}

/** Where the clicked block's TOP lands: this fraction down from the top of
 *  the preview viewport. ~1/4 leaves a little context above and plenty of
 *  room below. */
const ANCHOR_RATIO = 0.25;

export function useEditorScrollSync({
  editActive,
  scrollSync,
  scrollRef,
  articleRef,
  cursorLine,
  lineOffset,
  totalBodyLines,
  suppressRef,
}: ScrollSyncOptions): void {
  const timerRef = useRef<number | null>(null);
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

    // Align a point INSIDE the target block to the fixed anchor. `fraction`
    // is how far the clicked line sits through the block's source-line span
    // (0 = block top). Source-line stamps are per top-level block, so for a
    // tall block (long table / code / list) the clicked editor line maps to
    // the block START; without interpolation we'd anchor the block top and
    // the actual clicked content could land far below the fold ("not in
    // view"). Interpolating by line fraction puts the clicked region near
    // the anchor instead. Approximate (assumes ~uniform line height) but
    // keeps the relevant rows on screen.
    const applyScroll = (scroller: HTMLElement, target: HTMLElement, fraction: number) => {
      // Use LAYOUT metrics only (offsetTop / offsetHeight / clientHeight),
      // never getBoundingClientRect. PageZoom applies `body { zoom }`, under
      // which getBoundingClientRect reports VISUAL (zoomed) coordinates while
      // scrollTop is in LAYOUT coordinates — mixing them made every jump land
      // off by the zoom factor (worse the farther the target). offset*/client*
      // share scrollTop's coordinate space, so this is zoom-invariant. Relies
      // on `.scrollArea { position: relative }` so the offsetParent chain
      // terminates at the scroller.
      if (target.offsetParent === null && target.offsetHeight === 0) return; // hidden
      let top = 0;
      let node: HTMLElement | null = target;
      while (node && node !== scroller) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      const pointTop = top + target.offsetHeight * fraction;
      scroller.scrollTop = pointTop - scroller.clientHeight * ANCHOR_RATIO;
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

      // Find the block whose stamped line is the largest ≤ bodyLine (the
      // block containing the cursor) AND the next block's start line (the
      // smallest stamp > bodyLine) to bound this block's source-line span.
      const nodes = article.querySelectorAll<HTMLElement>('[data-source-line]');
      let bestLine = -1;
      let nextLine = Infinity;
      let target: HTMLElement | null = null;
      for (const el of nodes) {
        const ln = Number(el.getAttribute('data-source-line'));
        if (!Number.isFinite(ln)) continue;
        if (ln <= bodyLine && ln > bestLine) {
          bestLine = ln;
          target = el;
        }
        if (ln > bodyLine && ln < nextLine) nextLine = ln;
      }
      if (!target) {
        if (scrollSync) scroller.scrollTo({ top: 0 });
        return;
      }

      // How far the cursor line sits through this block's source span. For
      // the last stamped block (no following stamp) fall back to the total
      // body line count so a deep click in a long final block still
      // interpolates instead of anchoring the block top.
      const spanEnd = Number.isFinite(nextLine)
        ? nextLine
        : totalBodyLines != null && totalBodyLines > bestLine
          ? totalBodyLines + 1
          : bestLine; // unknown span → fraction 0
      const fraction =
        spanEnd > bestLine
          ? Math.max(0, Math.min((bodyLine - bestLine) / (spanEnd - bestLine), 1))
          : 0;

      if (scrollSync) applyScroll(scroller, target, fraction);
      flashElement(target);
    };

    timerRef.current = window.setTimeout(run, 50);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [editActive, scrollSync, cursorLine, lineOffset, totalBodyLines, scrollRef, articleRef, suppressRef]);
}
