/**
 * Inline frontmatter splitter used by DocumentView (PR-2).
 *
 * DocumentView wants the body without frontmatter BEFORE handing the
 * text to `<Markdown>`, so it can render the collapsible widget
 * separately. Splitting here keeps everything synchronous and avoids
 * juggling `vfile.data` through react-markdown's internals.
 *
 * Format recognized: a leading `---` line (optionally with trailing
 * whitespace), YAML lines, then a closing `---` line. Anything else is
 * treated as a frontmatter-less document.
 */

export interface SplitFrontmatter {
  /** Raw YAML between the fences (no trailing newline). */
  raw: string;
  /** Markdown body after the closing fence. */
  body: string;
}

/**
 * Try to split a document into its YAML frontmatter and the remaining
 * body. Returns `null` when the document has no frontmatter (more
 * common case), so the caller can branch with a single nullish check.
 */
export function splitFrontmatter(text: string): SplitFrontmatter | null {
  // Tolerate UTF-8 BOM + Windows line endings.
  const normalized = text.replace(/^﻿/, '');
  // The opening fence must be the first line.
  const lines = normalized.split(/\r?\n/);
  if (lines.length < 3) return null;
  if (lines[0].trim() !== '---') return null;

  // Find the closing fence (skip the first line, which is the opener).
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return null;

  const raw = lines.slice(1, close).join('\n');
  const body = lines.slice(close + 1).join('\n');
  return { raw, body };
}
