import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkFrontmatter from 'remark-frontmatter';
import { remarkAlert } from 'remark-github-blockquote-alert';
import rehypeKatex from 'rehype-katex';
import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import { createHighlighterCore } from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';
import type { LanguageInput, ThemeInput } from 'shiki/core';
import type { PluggableList } from 'unified';

/**
 * Plugin chain for `react-markdown` (PR-2 scope).
 *
 * Languages are pre-loaded eagerly so the rehype-shiki transform stays
 * synchronous (lets us use the sync `<Markdown>` component instead of
 * `<MarkdownAsync>` / `<MarkdownHooks>`). Cold-start cost is small —
 * Shiki's WASM oniguruma + ~16 grammars ~~ a few hundred KB total.
 *
 * Both light AND dark themes are loaded so PR-6 can flip via CSS
 * variables without re-creating the highlighter. Until PR-6 ships an
 * actual theme switcher, `defaultColor: 'light'` makes the rendered
 * spans use the light palette directly.
 */

/** Languages bundled by default. PR-2 covers the common doc set; an
 * extra-language plugin can be added later when needed. */
const SHIKI_LANGS = [
  'js',
  'ts',
  'jsx',
  'tsx',
  'json',
  'yaml',
  'bash',
  'python',
  'rust',
  'go',
  'html',
  'css',
  'md',
  'sql',
  'diff',
  'toml',
] as const;

const SHIKI_THEMES = ['github-light', 'github-dark'] as const;

/**
 * Build the Shiki highlighter once on module load. The result is a
 * Promise that resolves to a configured highlighter; the plugin chain
 * factory awaits it so callers get a ready-to-use array.
 */
const highlighterPromise = createHighlighterCore({
  // Each `@shikijs/themes/<name>` / `@shikijs/langs/<name>` module
  // default-exports a registration object that satisfies Shiki's
  // `ThemeInput` / `LanguageInput`. Type the dynamic-import callbacks
  // explicitly so we don't need an `as any` escape hatch.
  themes: await Promise.all(
    SHIKI_THEMES.map((name) =>
      import(`@shikijs/themes/${name}`).then((m: { default: ThemeInput }) => m.default),
    ),
  ),
  langs: await Promise.all(
    SHIKI_LANGS.map((name) =>
      import(`@shikijs/langs/${name}`).then((m: { default: LanguageInput }) => m.default),
    ),
  ),
  engine: createOnigurumaEngine(import('shiki/wasm')),
});

const highlighter = await highlighterPromise;

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
 * error (KaTeX inserts its own DOM, Shiki only touches `<code>`). */
export const rehypePlugins: PluggableList = [
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
