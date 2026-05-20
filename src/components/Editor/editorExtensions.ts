import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting, indentUnit } from '@codemirror/language';
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

const lightChrome = EditorView.theme(
  {
    '&': {
      color: '#1f2328',
      backgroundColor: '#ffffff',
    },
    '.cm-content': { caretColor: '#1f2328' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1f2328' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#0969da26' },
    '.cm-activeLine': { backgroundColor: '#f6f8fa80' },
    '.cm-gutters': {
      backgroundColor: '#ffffff',
      color: '#8c959f',
      border: 'none',
      fontFamily: GUTTER_FONT,
    },
    '.cm-activeLineGutter': { backgroundColor: '#f6f8fa', color: '#1f2328' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#eaeef2',
      border: 'none',
      color: '#6e7781',
    },
    '.cm-selectionMatch': { backgroundColor: '#bbdfff80' },
    '.cm-searchMatch': { backgroundColor: '#fae17d80' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#ffd33d80' },
  },
  { dark: false },
);

const darkChrome = EditorView.theme(
  {
    '&': {
      color: '#e6edf3',
      backgroundColor: '#0d1117',
    },
    '.cm-content': { caretColor: '#e6edf3' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e6edf3' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#1f6feb44' },
    '.cm-activeLine': { backgroundColor: '#161b2280' },
    '.cm-gutters': {
      backgroundColor: '#0d1117',
      color: '#6e7681',
      border: 'none',
      fontFamily: GUTTER_FONT,
    },
    '.cm-activeLineGutter': { backgroundColor: '#161b22', color: '#e6edf3' },
    '.cm-foldPlaceholder': {
      backgroundColor: '#21262d',
      border: 'none',
      color: '#8b949e',
    },
    '.cm-selectionMatch': { backgroundColor: '#3fb95040' },
    '.cm-searchMatch': { backgroundColor: '#bb800950' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#bb800980' },
  },
  { dark: true },
);

/** Markdown token highlight for the light palette. The Lezer markdown
 *  grammar maps headings to `tags.heading1..6`, emphasis/strong to their
 *  tags, inline+fenced code to `tags.monospace`, punctuation (markers)
 *  to `tags.processingInstruction`, and so on. */
const lightHighlight = HighlightStyle.define([
  { tag: t.heading1, color: '#0550ae', fontWeight: '700' },
  { tag: t.heading2, color: '#0550ae', fontWeight: '700' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: '#0969da', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700', color: '#1f2328' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#6e7781' },
  { tag: [t.link, t.url], color: '#0969da', textDecoration: 'underline' },
  { tag: t.monospace, color: '#cf222e' },
  { tag: t.quote, color: '#6a737d', fontStyle: 'italic' },
  { tag: t.list, color: '#0969da' },
  { tag: t.processingInstruction, color: '#9a6700' },
  { tag: t.labelName, color: '#116329' },
  { tag: t.string, color: '#0a3069' },
  { tag: t.contentSeparator, color: '#6e7781' },
]);

/** Markdown token highlight for the dark palette (GitHub dark values). */
const darkHighlight = HighlightStyle.define([
  { tag: t.heading1, color: '#79c0ff', fontWeight: '700' },
  { tag: t.heading2, color: '#79c0ff', fontWeight: '700' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: '#58a6ff', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700', color: '#e6edf3' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: '#8b949e' },
  { tag: [t.link, t.url], color: '#58a6ff', textDecoration: 'underline' },
  { tag: t.monospace, color: '#ff7b72' },
  { tag: t.quote, color: '#8b949e', fontStyle: 'italic' },
  { tag: t.list, color: '#58a6ff' },
  { tag: t.processingInstruction, color: '#d29922' },
  { tag: t.labelName, color: '#7ee787' },
  { tag: t.string, color: '#a5d6ff' },
  { tag: t.contentSeparator, color: '#8b949e' },
]);

/** Resolve the chrome + highlight extension pair for the active app
 *  theme. `effective` is the resolved light/dark (never 'system') — the
 *  caller passes ThemeProvider's `effective`. */
export function themeExtension(effective: 'light' | 'dark'): Extension {
  return effective === 'dark'
    ? [darkChrome, syntaxHighlighting(darkHighlight)]
    : [lightChrome, syntaxHighlighting(lightHighlight)];
}

/** Settings-driven extensions (R-EDIT-12): soft-wrap + indent width.
 *  Line numbers are handled separately via @uiw/react-codemirror's
 *  `basicSetup` prop (it owns the lineNumbers gutter). */
export function settingsExtension(editor: EditorSettings): Extension {
  const exts: Extension[] = [indentUnit.of(' '.repeat(editor.tabSize))];
  if (editor.lineWrap) exts.push(EditorView.lineWrapping);
  return exts;
}
