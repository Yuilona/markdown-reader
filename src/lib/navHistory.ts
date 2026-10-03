/**
 * Back / forward document history (Alt+← / Alt+→, mouse side buttons,
 * titlebar arrows) — pure state transitions, kept separate from the React
 * wiring in App.tsx so they are unit-testable.
 *
 * `entries` are document paths in visit order; `index` points at the entry
 * for the most recently shown document (-1 = nothing visited yet). Unnamed
 * (Ctrl+N) buffers have no path and are never recorded.
 *
 * Closing a document (Ctrl+W) or switching to an unnamed buffer leaves the
 * history alone, so Back from there returns to the document that was open
 * — the same as a browser tab's back button after leaving a page.
 */

export interface NavHistory {
  entries: string[];
  index: number;
}

/** Cap so a long session can't grow the list without bound. */
const MAX_ENTRIES = 100;

export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 };

/**
 * Record that `path` is now shown. A revisit of the current entry (a
 * reload, a save, a back/forward move that already set `index`) is a
 * no-op; anything else drops the forward branch and appends, like a
 * browser.
 */
export function recordVisit(history: NavHistory, path: string): NavHistory {
  if (history.entries[history.index] === path) return history;
  const entries = [...history.entries.slice(0, history.index + 1), path].slice(-MAX_ENTRIES);
  return { entries, index: entries.length - 1 };
}

export interface NavTarget {
  index: number;
  path: string;
}

/** Where Back goes from `currentPath` (null when no document is shown). */
export function backTarget(history: NavHistory, currentPath: string | null): NavTarget | null {
  const { entries, index } = history;
  if (index < 0) return null;
  // Current document isn't the recorded one (closed, or an unnamed buffer):
  // Back reopens the recorded one.
  if (currentPath !== entries[index]) return { index, path: entries[index] };
  return index > 0 ? { index: index - 1, path: entries[index - 1] } : null;
}

/** Where Forward goes from `currentPath`. */
export function forwardTarget(history: NavHistory, currentPath: string | null): NavTarget | null {
  const { entries, index } = history;
  if (index < 0 || currentPath !== entries[index] || index + 1 >= entries.length) return null;
  return { index: index + 1, path: entries[index + 1] };
}

/** Commit a successful back/forward move. The document swap that follows
 *  then hits `recordVisit`'s no-op path instead of truncating history. */
export function moveTo(history: NavHistory, target: NavTarget): NavHistory {
  return { ...history, index: target.index };
}
