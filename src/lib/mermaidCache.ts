/**
 * Module-scoped in-memory cache of rendered Mermaid SVGs (R4.4).
 *
 * Why module-scoped instead of component-state:
 *   - Multiple `<Mermaid>` instances in the same document must share the
 *     cache so two identical diagrams don't both pay the render cost.
 *   - Scrolling that unmounts/remounts a Mermaid block (e.g. when a
 *     virtualized list lands in v0.2) must hit the cache too.
 *
 * Keying:
 *   `${theme}::${source}` so a future theme switch (PR-6) can invalidate
 *   only the entries for the OLD theme via `clearCacheForTheme(theme)`,
 *   without dropping the active theme's entries.
 *
 * Persistence:
 *   None. Per R4.4 there is NO on-disk cache; the map dies with the
 *   page (and is implicitly cleared on `window.beforeunload`).
 */

const cache = new Map<string, string>();

function key(source: string, theme: string): string {
  return `${theme}::${source}`;
}

export function getCached(source: string, theme: string): string | undefined {
  return cache.get(key(source, theme));
}

export function putCached(source: string, theme: string, svg: string): void {
  cache.set(key(source, theme), svg);
}

/**
 * Drop every cached entry for a given theme.
 *
 * PR-6 (theme switch) will call this with the OLD theme name after
 * flipping the app theme so re-mounting Mermaid components forces a
 * re-render in the new palette.
 */
export function clearCacheForTheme(theme: string): void {
  const prefix = `${theme}::`;
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}
