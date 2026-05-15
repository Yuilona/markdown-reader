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
 * Initialization is performed once, here, immediately after the module
 * loads. PR-6 (theme system) will need to:
 *   1. Re-call `mermaid.initialize({ theme: '<new-theme>' })` after a
 *      theme switch so newly rendered diagrams pick up the new palette.
 *   2. Call `clearCacheForTheme(<old-theme>)` from `mermaidCache.ts` so
 *      previously rendered SVGs get re-rendered against the new theme.
 */

type MermaidModule = typeof import('mermaid');

let mermaidPromise: Promise<MermaidModule> | null = null;

export function loadMermaid(): Promise<MermaidModule> {
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = import('mermaid').then((mod) => {
    mod.default.initialize({
      // We render manually (`mermaid.render()`), never letting Mermaid
      // walk the DOM and replace `.mermaid` blocks itself.
      startOnLoad: false,
      // PR-6 will swap this dynamically on theme change.
      theme: 'default',
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
