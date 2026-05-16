import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import { remarkAlert } from 'remark-github-blockquote-alert';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import type { PluggableList } from 'unified';

/**
 * Plugin chain for `react-markdown` (PR-2 scope).
 *
 * Shiki themes/langs are loaded via STATIC `import()` calls — Vite can
 * statically analyze each literal path and pre-bundle the module. Do NOT
 * refactor back to a template-literal loop (`import(`@shikijs/langs/${name}`)`):
 * Vite cannot analyze that pattern, the dynamic-resolution fallback fails
 * inside Tauri's webview at runtime, the top-level await throws, the
 * module fails to load, and the entire app blank-screens.
 *
 * Shiki's `createHighlighterCore` accepts Promise<ThemeInput> /
 * Promise<LanguageInput> directly, so we just pass each `import()` result
 * without `.then(m => m.default)` or `await` indirection.
 *
 * Both light AND dark themes are loaded so PR-6 can flip via CSS
 * variables without re-creating the highlighter. Until PR-6 ships an
 * actual theme switcher, `defaultColor: 'light'` makes the rendered
 * spans use the light palette directly.
 */
const highlighter = await createHighlighterCore({
  themes: [
    import('@shikijs/themes/github-light'),
    import('@shikijs/themes/github-dark'),
  ],
  langs: [
    import('@shikijs/langs/javascript'),
    import('@shikijs/langs/typescript'),
    import('@shikijs/langs/jsx'),
    import('@shikijs/langs/tsx'),
    import('@shikijs/langs/json'),
    import('@shikijs/langs/yaml'),
    import('@shikijs/langs/bash'),
    import('@shikijs/langs/python'),
    import('@shikijs/langs/rust'),
    import('@shikijs/langs/go'),
    import('@shikijs/langs/html'),
    import('@shikijs/langs/css'),
    import('@shikijs/langs/markdown'),
    import('@shikijs/langs/sql'),
    import('@shikijs/langs/diff'),
    import('@shikijs/langs/toml'),
  ],
  engine: createOnigurumaEngine(import('shiki/wasm')),
});

/** Remark plugins (run on the mdast). The YAML frontmatter is stripped
 * BEFORE this pipeline runs, by `splitFrontmatter` in `parseFrontmatter.ts`
 * (see DocumentView.tsx) — the dedicated splitter keeps the body
 * frontmatter-free so we don't need a custom extractor plugin here.
 * `remark-frontmatter` is still wired in defensively in case markdown
 * with a leading `---` block ever bypasses the splitter (e.g. via
 * future `[next.md](#)` link routing). */
export const remarkPlugins: PluggableList = [
  // Parse YAML / TOML front-matter blocks (we only enable `yaml` for v0.1).
  [remarkFrontmatter, ['yaml']],
  // GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks, footnotes.
  remarkGfm,
  // `$x$` and `$$x$$` math syntax → `math` / `inlineMath` nodes (rendered later by KaTeX).
  remarkMath,
  // GitHub-style blockquote alerts: `> [!NOTE]`, `[!TIP]`, etc.
  remarkAlert,
];

/** Rehype plugins (run on the hast). KaTeX must come BEFORE Shiki so
 * KaTeX can fail-soft on bad formulas without Shiki swallowing the
 * error (KaTeX inserts its own DOM, Shiki only touches `<code>`).
 *
 * `rehype-slug` adds a deterministic GitHub-flavor `id` attribute to
 * every heading. Required by the link router (R7.4) so anchor links
 * like `[top](#heading)` resolve via `document.getElementById`. Without
 * this plugin, react-markdown emits headings WITHOUT ids and every
 * anchor click silently no-ops.
 */
export const rehypePlugins: PluggableList = [
  // R7.4 prerequisite: stamp deterministic ids on headings so the link
  // router's anchor-scroll branch can find the target.
  rehypeSlug,
  // R12.3: never throw on bad formulas — KaTeX renders a red-styled
  // .katex-error span containing the original source.
  [rehypeKatex, { throwOnError: false, errorColor: '#cc0000' }],
  [
    rehypeShikiFromHighlighter,
    highlighter,
    {
      themes: { light: 'github-light', dark: 'github-dark' },
      // Show readable colors in PR-2; PR-6 will hook real CSS variables
      // so switching the app theme flips both palettes live.
      defaultColor: 'light',
      // Add `language-xxx` class so our CodeBlock wrapper can read the
      // language name without parsing markdown meta strings.
      addLanguageClass: true,
      // If the markdown specifies an unknown lang, fall back to plain text
      // instead of throwing.
      fallbackLanguage: 'text',
    },
  ],
];
