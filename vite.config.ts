import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite + Tauri 2 conventions: fixed port 1420, no auto-clear, no HMR overlay races.
// See https://tauri.app/v2/guides/ for the standard recipe.
//
// PR-9 chunk-splitting strategy:
//
//   Before PR-9 the main `index-*.js` was ~775 KB minified (almost
//   entirely react-markdown + remark/rehype/mdast/unified + KaTeX +
//   the Shiki engine). Mermaid is already lazy-loaded (R4.1), and
//   each Shiki language grammar is split per-language by Vite's
//   default code-splitting because `lib/markdownPlugins.ts` uses
//   static `import('@shikijs/langs/<lang>')` per language.
//
//   PR-9 adds `manualChunks` to hoist the big always-needed vendors
//   out of the main entry into named long-lived chunks. The browser
//   (WebView2) fetches them in parallel and the per-fetch overhead
//   is negligible because every fetch is a local file via the
//   `tauri://` protocol — there's no TCP/TLS cost.
//
//   Goals: main `index-*.js` < 200 KB; total transfer unchanged but
//   parallel; long-term cache friendliness (a code change in the
//   markdown pipeline doesn't bust the react-vendor chunk hash).
//
//   Why we lump all shiki-langs into ONE chunk (and not split per
//   language): for an offline desktop app fetched via `tauri://`
//   there's no TCP/TLS overhead per request, so the only relevant
//   metric is "bytes parsed at first doc open". A single ~1.1 MB
//   chunk (~125 KB gzip) parses faster than 16 micro-chunks because
//   the V8 parser amortizes setup. The downside (paying for a
//   language the user's current doc doesn't need) is irrelevant in
//   practice — these grammars are tiny compared to the Shiki engine
//   itself (~700 KB) and Mermaid (~600 KB), and the chunk is loaded
//   ONCE per app lifetime via the markdown-pipeline preload chain.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Order matters: most-specific patterns first, broad ones last.
          // Shiki sub-packages are split BEFORE the catch-all `shiki/`
          // rule so language/theme grammars land in their dedicated chunks
          // instead of the generic Shiki engine chunk.
          if (id.includes('node_modules/@shikijs/langs/')) return 'shiki-langs';
          if (id.includes('node_modules/@shikijs/themes/')) return 'shiki-themes';
          if (
            id.includes('node_modules/shiki/') ||
            id.includes('node_modules/@shikijs/')
          )
            return 'shiki';
          if (id.includes('node_modules/katex/')) return 'katex';
          // The full markdown pipeline: react-markdown + the entire
          // remark/rehype/mdast/micromark/unified family. These travel
          // together at runtime, so grouping them avoids many tiny
          // cross-chunk imports.
          if (
            id.includes('node_modules/react-markdown/') ||
            id.includes('node_modules/remark-') ||
            id.includes('node_modules/rehype-') ||
            id.includes('node_modules/mdast-') ||
            id.includes('node_modules/micromark') ||
            id.includes('node_modules/unified/') ||
            id.includes('node_modules/unist-') ||
            id.includes('node_modules/vfile') ||
            id.includes('node_modules/hast-')
          )
            return 'markdown-pipeline';
          // React + ReactDOM + scheduler. Long-lived chunk that almost
          // never changes between releases.
          if (
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler/')
          )
            return 'react-vendor';
          return undefined;
        },
      },
    },
    // Mermaid stays in its lazy chunk (it's already > 500 KB on its
    // own). Bump the warning ceiling so the split-out vendor chunks
    // don't trip the per-chunk threshold.
    chunkSizeWarningLimit: 800,
  },
});
