/**
 * Lazy loader for the Mermaid library (R4.1).
 *
 * Mermaid's bundle is roughly 4 MB minified — we MUST NOT include it in
 * the main chunk, otherwise cold start regresses noticeably. This module
 * holds a singleton promise so the first `<Mermaid>` mount triggers a
 * dynamic `import()` (Vite emits a separate chunk) and every subsequent
 * mount reuses the same resolved module.
 *
 * The `import()` specifier is a literal string on purpose. Template
 * literals defeat Vite's static analysis and blank-screen at runtime
 * inside Tauri's webview — see the long comment at the top of
 * `markdownPlugins.ts` for the cautionary tale.
 *
 * Theme switching (R4.3, R4.4) — PR-6:
 *   `setMermaidTheme(name)` re-initializes mermaid with the new theme
 *   AND clears the in-memory cache entries for the PREVIOUS theme so
 *   re-mounting Mermaid components forces a fresh render in the new
 *   palette. The cache key already includes the theme name so the new
 *   theme's cache is preserved across toggles (e.g. toggling
 *   light→dark→light reuses the cached light SVGs).
 */

import { clearCacheForTheme } from './mermaidCache';

export type MermaidTheme = 'default' | 'dark' | 'forest' | 'neutral';

type MermaidModule = typeof import('mermaid');

let mermaidPromise: Promise<MermaidModule> | null = null;
/** The theme currently configured inside the Mermaid instance. Tracked
 *  here so `setMermaidTheme` knows which cache slice to invalidate. */
let currentTheme: MermaidTheme = 'default';

export function loadMermaid(): Promise<MermaidModule> {
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = import('mermaid').then((mod) => {
    mod.default.initialize({
      // We render manually (`mermaid.render()`), never letting Mermaid
      // walk the DOM and replace `.mermaid` blocks itself.
      startOnLoad: false,
      // PR-6 swaps this dynamically via `setMermaidTheme`. The initial
      // value matches the default light theme; the ThemeProvider's mount
      // effect calls `setMermaidTheme` if the user prefers dark.
      theme: currentTheme,
      // Avoid arbitrary HTML execution from user-authored documents.
      securityLevel: 'strict',
      // Per-block error UI is OUR responsibility (R4.5); silence
      // Mermaid's built-in red error rectangle so it doesn't appear
      // alongside our own fallback.
      suppressErrorRendering: true,
    });
    return mod;
  });

  return mermaidPromise;
}

/** Return the currently-configured Mermaid theme name. Used by the
 *  `<Mermaid>` cache lookup so its key matches the live palette. */
export function getMermaidTheme(): MermaidTheme {
  return currentTheme;
}

/**
 * Switch the active Mermaid theme (R4.3, R4.4).
 *
 * Idempotent: no-op when the requested theme equals the current one,
 * which keeps the React provider free to call this unconditionally on
 * every effective-theme change.
 *
 * Re-initializes mermaid via `mermaid.initialize({ theme })` — this is
 * the official supported way to change palette mid-session. THEN invokes
 * `clearCacheForTheme(oldTheme)` so SVGs cached under the previous
 * theme key are dropped; any remount with the same `source` triggers a
 * fresh render via `mermaid.render` and produces colors in the new
 * theme. The current theme's cached SVGs (if any from a previous toggle
 * cycle) are preserved, which gives a free fast-path on light↔dark
 * thrashing.
 */
export async function setMermaidTheme(theme: MermaidTheme): Promise<void> {
  if (theme === currentTheme) return;
  const oldTheme = currentTheme;
  // Ensure the mermaid module is loaded before we can re-initialize.
  // If no Mermaid block has been mounted yet, we just remember the
  // selection here and `loadMermaid()` will use it on first load.
  const mod = await loadMermaid();
  mod.default.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    suppressErrorRendering: true,
  });
  currentTheme = theme;
  // Drop the previous theme's cache so any remount re-renders in the
  // new palette. (Cache entries for the NEW theme, if any from a
  // prior toggle cycle, are intentionally retained.)
  clearCacheForTheme(oldTheme);
}
