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
/** The theme most recently REQUESTED via `setMermaidTheme`. Updated
 *  synchronously so the latest request always wins (see setMermaidTheme). */
let wantedTheme: MermaidTheme = 'default';
/** The theme actually configured inside the loaded Mermaid instance. Tracked
 *  so `setMermaidTheme` knows which cache slice to invalidate. */
let appliedTheme: MermaidTheme = 'default';

function initialize(mod: MermaidModule, theme: MermaidTheme): void {
  mod.default.initialize({
    // We render manually (`mermaid.render()`), never letting Mermaid
    // walk the DOM and replace `.mermaid` blocks itself.
    startOnLoad: false,
    theme,
    // Avoid arbitrary HTML execution from user-authored documents.
    securityLevel: 'strict',
    // Per-block error UI is OUR responsibility (R4.5); silence
    // Mermaid's built-in red error rectangle so it doesn't appear
    // alongside our own fallback.
    suppressErrorRendering: true,
  });
  appliedTheme = theme;
}

export function loadMermaid(): Promise<MermaidModule> {
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = import('mermaid').then((mod) => {
    // Initialize with whatever was requested most recently — a theme
    // switch that happened while the chunk was downloading is honored.
    initialize(mod, wantedTheme);
    return mod;
  });

  return mermaidPromise;
}

/** Return the theme currently configured inside the Mermaid instance.
 *  `<Mermaid>` checks it after a render so it never caches an SVG under a
 *  theme key it wasn't actually painted in. */
export function getMermaidTheme(): MermaidTheme {
  return appliedTheme;
}

/**
 * Switch the active Mermaid theme (R4.3, R4.4).
 *
 * Latest request wins. BUG (fixed): this used to compare against the theme
 * applied so far and bail on equality, then await the (~4 MB) module load
 * before applying. At startup ThemeProvider first requests the OS-derived
 * theme (e.g. 'dark'), then the persisted setting (e.g. 'default') a moment
 * later — the second call saw "already default" and returned, then the
 * first call finished and applied 'dark', so a light-themed app painted
 * dark diagrams. Now the request is recorded synchronously and a call whose
 * request was superseded while it awaited does nothing.
 *
 * Not loaded yet → just record the request; `loadMermaid()` initializes
 * with it. So a dark-mode start no longer downloads Mermaid for documents
 * without diagrams.
 *
 * On an actual switch: re-initialize (the supported way to change palette
 * mid-session), then `clearCacheForTheme(oldTheme)` so remounts re-render in
 * the new palette. The new theme's cached SVGs from an earlier toggle cycle
 * are kept — a free fast-path on light↔dark thrashing.
 */
export async function setMermaidTheme(theme: MermaidTheme): Promise<void> {
  wantedTheme = theme;
  if (!mermaidPromise) return;
  const mod = await mermaidPromise;
  // Superseded by a newer request while we awaited — let that call apply.
  if (wantedTheme !== theme || appliedTheme === theme) return;
  const oldTheme = appliedTheme;
  initialize(mod, theme);
  clearCacheForTheme(oldTheme);
}
