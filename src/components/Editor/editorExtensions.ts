import { EditorView } from '@codemirror/view';
import {
  HighlightStyle,
  syntaxHighlighting,
  indentUnit,
  defaultHighlightStyle,
} from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

import type { EditorSettings } from '../../lib/settings';

/**
 * CodeMirror 6 theming + settings-driven extensions (v1.0 PR-B,
 * R-EDIT-1.4 / R-EDIT-11).
 *
 * Two GitHub-flavored palettes (light + dark) that line up with the
 * preview side (github-markdown-css) so the editor and the rendered
 * output read as one surface. Each palette is the pair of:
 *   - an `EditorView.theme(...)` for editor chrome (background, cursor,
 *     selection, gutter, active line)
 *   - a `HighlightStyle` mapped through the Lezer markdown grammar's
 *     tags so headings are colored, bold is heavy, inline code is
 *     mono-tinted, etc. (the AC's "标题彩色、bold 加重、code 等宽").
 *
 * Theme switching (R-EDIT-11.2/11.3): rather than the PRD's
 * remount-via-key approach, we hand the active palette to the editor as
 * part of its memoized `extensions` array keyed on `effective`. When the
 * theme flips, @uiw/react-codemirror reconfigures the live EditorView
 * (a `StateEffect.reconfigure` under the hood) — the document, cursor,
 * selection, and scroll position are preserved by definition because the
 * EditorState is untouched. This is strictly better than a remount: no
 * flash, no manual selection save/restore, no lost undo history.
 */

const GUTTER_FONT = 'var(--font-stack-code)';

/** Editor chrome (background, cursor, selection, gutter, active line,
 *  search/selection match) wired to the app's CSS custom properties so
 *  the editor follows whatever palette is active — the default GitHub
 *  palette (theme.light.css / theme.dark.css) or any `data/user.css`
 *  override — with no visual change for the default theme. The color
 *  values are identical var() references for light and dark (they
 *  resolve per active `[data-theme]`); only the `dark` flag handed to
 *  CM6 differs, which it still needs for its internal light/dark logic. */
function chromeTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        color: 'var(--fg-default)',
        backgroundColor: 'var(--bg-canvas)',
      },
      '.cm-content': { caretColor: 'var(--accent)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
      // Selection background. CodeMirror's basicSetup enables
      // drawSelection(), so mouse selection is painted by an overlay DOM
      // layer (`.cm-selectionLayer .cm-selectionBackground`), not just by
      // the browser's native `::selection`.
      //
      // CM6's base theme writes focused rules with its light/dark scope:
      //   &light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
      //   &dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
      // That compiles to five class selectors. The duplicated target class
      // below is intentional: it bumps specificity to six, so this theme
      // wins without relying on stylesheet insertion order or !important.
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground.cm-selectionBackground':
        { background: 'var(--cm-selection-bg)' },
      '.cm-selectionLayer .cm-selectionBackground': {
        background: 'var(--cm-selection-bg)',
      },
      '.cm-content ::selection': { background: 'var(--cm-selection-bg)' },
      // Active-line tint must remain TRANSLUCENT — the .cm-selectionLayer
      // sits at inline z-index:-1 (CM6 draw-selection assigns this), so
      // .cm-activeLine (z:auto, inside .cm-content) paints OVER the selection.
      // If bg-hover is opaque (it is in the GitHub light/dark + Claude light
      // palettes — e.g. #f0eee6 in Claude light), the active row HIDES the
      // selection on the very line the cursor is on, which is precisely the
      // row a mouse-drag selection always occupies. Mixing to ~45% alpha lets
      // the orange/blue selection tint show through while still hinting the
      // active row. color-mix is supported by Win11 WebView2 (Chromium ≥111).
      '.cm-activeLine': {
        backgroundColor: 'color-mix(in srgb, var(--bg-hover) 45%, transparent)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--fg-subtle)',
        border: 'none',
        fontFamily: GUTTER_FONT,
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--bg-hover)',
        color: 'var(--fg-default)',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: 'var(--bg-elevated)',
        border: 'none',
        color: 'var(--fg-subtle)',
      },
      '.cm-selectionMatch': { backgroundColor: 'var(--accent-bg-soft)' },
      '.cm-searchMatch': { backgroundColor: 'var(--accent-bg-soft)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--bg-active)' },
    },
    { dark },
  );
}

/** Markdown token highlight wired to the app's CSS custom properties.
 *  The Lezer markdown grammar maps headings to `tags.heading1..6`,
 *  emphasis/strong to their tags, inline+fenced code to `tags.monospace`,
 *  punctuation (markers) to `tags.processingInstruction`, and so on. A
 *  single style serves both light and dark because the `var(--cm-*)`
 *  colors resolve per the active `[data-theme]` (default GitHub palette
 *  in theme.light.css / theme.dark.css, or any `data/user.css` override)
 *  — no visual change for the default theme. */
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--cm-heading)', fontWeight: '700' },
  { tag: t.heading2, color: 'var(--cm-heading)', fontWeight: '700' },
  {
    tag: [t.heading3, t.heading4, t.heading5, t.heading6],
    color: 'var(--cm-heading-sub)',
    fontWeight: '600',
  },
  { tag: t.strong, fontWeight: '700', color: 'var(--cm-strong)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--cm-strikethrough)' },
  { tag: [t.link, t.url], color: 'var(--cm-link)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--cm-code)' },
  { tag: t.quote, color: 'var(--cm-quote)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--cm-list)' },
  { tag: t.processingInstruction, color: 'var(--cm-marker)' },
  { tag: t.labelName, color: 'var(--cm-label)' },
  { tag: t.string, color: 'var(--cm-string)' },
  { tag: t.contentSeparator, color: 'var(--cm-separator)' },
]);

/** Resolve the chrome + highlight extension pair for the active app
 *  theme. `effective` is the resolved light/dark (never 'system') — the
 *  caller passes ThemeProvider's `effective`. */
export function themeExtension(effective: 'light' | 'dark'): Extension {
  return [
    chromeTheme(effective === 'dark'),
    // Markdown tokens (Claude/GitHub palette) — listed FIRST so it wins
    // precedence for the tags it defines (headings/bold/link/…).
    syntaxHighlighting(markdownHighlight),
    // Fenced-code tokens — per-language grammars get multi-color
    // highlighting readable in both themes. NOTE: this is a NON-fallback
    // highlighter on purpose. CodeMirror's getHighlighters() returns the
    // main highlighter facet if it's non-empty and ONLY falls back to the
    // fallback facet when there are zero main highlighters — it does NOT
    // merge per-tag. So a `{ fallback: true }` style here would be fully
    // ignored (markdownHighlight already occupies the main facet), leaving
    // code keywords/strings/etc. uncolored. Both must be main; precedence
    // (array order) lets markdownHighlight win the markdown tags and this
    // style cover everything else.
    syntaxHighlighting(effective === 'dark' ? oneDarkHighlightStyle : defaultHighlightStyle),
  ];
}

/** Settings-driven extensions (R-EDIT-12): soft-wrap + indent width.
 *  Line numbers are handled separately via @uiw/react-codemirror's
 *  `basicSetup` prop (it owns the lineNumbers gutter). */
export function settingsExtension(editor: EditorSettings): Extension {
  const exts: Extension[] = [indentUnit.of(' '.repeat(editor.tabSize))];
  if (editor.lineWrap) exts.push(EditorView.lineWrapping);
  return exts;
}
