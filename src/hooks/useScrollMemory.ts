import { useEffect, useRef, type RefObject } from 'react';

import { flushScroll, getScroll, saveScroll } from '../lib/scrollPositions';

/** Debounce window for recording the resting position into the in-memory
 *  cache (ms). 250ms balances "captures the user's resting position
 *  quickly" against "doesn't churn on every wheel tick". cr-performance
 *  #17: this `saveScroll` is now a cheap in-memory mutation (no disk I/O),
 *  so the cadence stays snappy. */
const SAVE_DEBOUNCE_MS = 250;

/** Coarser debounce for the actual atomic DISK write (ms). cr-performance
 *  #17: the per-tick read+filter+rewrite is gone — we now persist the
 *  in-memory array at most once per ~1.5s of activity (plus on doc-swap /
 *  unmount). 1.5s is short enough that a crash loses at most the last
 *  ~1.5s of scrolling. */
const FLUSH_DEBOUNCE_MS = 1500;

/** How many requestAnimationFrame attempts we make to restore a saved Y
 *  before giving up. The first frame after a content swap has the DOM
 *  but not necessarily the final scrollHeight (images / KaTeX / Mermaid
 *  may still be laying out). Three attempts at ~16ms each = ~50ms of
 *  ceiling, which is well below the eye's flicker threshold. */
const MAX_RESTORE_ATTEMPTS = 3;

/**
 * Scroll-position memory for the document scroller (R10.4).
 *
 * Responsibilities:
 *   1. When `currentDocPath` changes (including becoming non-null after
 *      app launch), look up the saved Y from `scroll-positions.json` and
 *      restore `scrollContainer.scrollTop` to it. Multiple rAF attempts
 *      are made because `scrollHeight` may grow as async content (images,
 *      KaTeX, Mermaid) lays out.
 *   2. On every scroll, debounce 250ms then persist the new Y.
 *   3. On unmount OR doc swap, flush any pending save before the path
 *      changes (otherwise the new doc's first scroll would steal the
 *      old doc's pending write).
 *
 * Crucially, the watcher-fired re-render (R2.6 external auto-reload)
 * does NOT change `currentDocPath` — only the text content of the doc.
 * React re-renders DocumentView's children with new text but does not
 * call this hook's restore path. The scroll position naturally survives
 * because the scroll container element stays mounted across the text
 * swap. (If the new content is shorter than the old scroll Y, the
 * browser pins to `scrollHeight - clientHeight` — fine.)
 */
export function useScrollMemory(
  scrollContainerRef: RefObject<HTMLElement | null>,
  currentDocPath: string | null,
): void {
  // Track the path the listener is currently saving FOR. Used to flush
  // before swapping to a new doc.
  const activePathRef = useRef<string | null>(null);
  // The pending in-memory-save handle (window.setTimeout) so we can
  // flush/cancel.
  const pendingTimerRef = useRef<number | null>(null);
  // The pending DISK-flush handle (coarser debounce). cr-performance #17.
  const flushTimerRef = useRef<number | null>(null);
  // The last scrollTop we observed — used by the flush path so we don't
  // need to re-read the DOM during cleanup.
  const lastYRef = useRef<number>(0);

  // ---- Save path: scroll listener + debounce. ----
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !currentDocPath) {
      activePathRef.current = null;
      return;
    }

    // Switch the "active" path so the cleanup function below knows which
    // file the pending Y belongs to.
    activePathRef.current = currentDocPath;
    lastYRef.current = container.scrollTop;

    const onScroll = () => {
      lastYRef.current = container.scrollTop;
      // 1) Record the resting position into the in-memory cache (cheap,
      //    no disk I/O — cr-performance #17), debounced at 250ms.
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
      const pathAtSchedule = currentDocPath;
      pendingTimerRef.current = window.setTimeout(() => {
        pendingTimerRef.current = null;
        void saveScroll(pathAtSchedule, lastYRef.current);
      }, SAVE_DEBOUNCE_MS);
      // 2) Schedule a coarser disk flush so we persist at most ~once per
      //    1.5s of continuous scrolling instead of rewriting the file on
      //    every 250ms tick (cr-performance #17).
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null;
        void flushScroll();
      }, FLUSH_DEBOUNCE_MS);
    };

    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', onScroll);
      // Flush before the doc swap so the next doc can't lose the previous
      // doc's position. Apply the pending in-memory save first (so the
      // very latest Y is recorded), then write to disk. Both are
      // fire-and-forget — the write goes through atomic .tmp + rename, so
      // a tear-down race can't corrupt the file. We chain the disk flush
      // AFTER the in-memory save resolves so the snapshot includes the
      // last position.
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      const pathToFlush = activePathRef.current;
      if (pathToFlush) {
        void saveScroll(pathToFlush, lastYRef.current).then(() => flushScroll());
      } else {
        void flushScroll();
      }
    };
  }, [scrollContainerRef, currentDocPath]);

  // ---- Restore path: separate effect so it runs on path change only. ----
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !currentDocPath) return;

    let cancelled = false;

    // Reset to top first so we don't visibly briefly show the OLD doc's
    // last position (the container element is reused across doc swaps).
    container.scrollTop = 0;

    (async () => {
      const savedY = await getScroll(currentDocPath);
      if (cancelled || savedY === null || savedY <= 0) return;

      let attempts = 0;
      const tryRestore = () => {
        if (cancelled) return;
        const c = scrollContainerRef.current;
        if (!c) return;
        const maxY = Math.max(0, c.scrollHeight - c.clientHeight);
        // If the doc isn't tall enough yet, retry on the next frame.
        // (Async content like images and Mermaid may extend scrollHeight
        // after the initial layout pass.)
        if (savedY > maxY && attempts < MAX_RESTORE_ATTEMPTS) {
          attempts += 1;
          // Scroll to the current max so the user at least sees the
          // bottom while async content settles — feels less jarring
          // than staying at 0.
          c.scrollTop = maxY;
          requestAnimationFrame(tryRestore);
          return;
        }
        const clamped = Math.min(savedY, maxY);
        c.scrollTop = clamped;
        // Sync our ref so the next debounced save sees the actual Y the
        // user is at (vs 0, which would clobber the saved position if
        // they don't scroll before the doc closes).
        lastYRef.current = clamped;
      };

      requestAnimationFrame(tryRestore);
    })();

    return () => {
      cancelled = true;
    };
  }, [scrollContainerRef, currentDocPath]);
}
