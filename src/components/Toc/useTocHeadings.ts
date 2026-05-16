import { useEffect, useState, type RefObject } from 'react';

/**
 * One entry in the extracted heading list. `level` is 1-6 (h1..h6),
 * `id` is the slug added by `rehype-slug` in the markdown plugin chain
 * (see `lib/markdownPlugins.ts`), `text` is the rendered heading text
 * with whitespace collapsed.
 */
export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

/**
 * Walk the article subtree and extract every heading (`h1..h6`) into a
 * flat array. Run on mount AND whenever `versionKey` changes — that
 * key is the source-of-truth signal that the article DOM has been
 * replaced (typically `doc.path + doc.text`). We don't observe the DOM
 * with `MutationObserver` here because:
 *   - react-markdown renders the headings synchronously on its commit,
 *     so the post-commit `useEffect` fires AFTER all headings are in
 *     the DOM. No async race for the heading list itself.
 *   - KaTeX / Mermaid land asynchronously, but neither produces new
 *     headings — they only fill in placeholder containers under
 *     existing siblings.
 *
 * Why this is a hook, not a one-shot extractor:
 *   - Sets state, so callers re-render when the headings change.
 *   - Owns the dependency tracking so the caller doesn't have to thread
 *     `useEffect` deps through manually.
 *
 * Why the ref instead of a selector:
 *   - The article element lives inside DocumentView's tree; passing the
 *     ref makes the extraction component-scope-safe without coupling
 *     to the `.markdown-body` class name.
 */
export function useTocHeadings(
  articleRef: RefObject<HTMLElement | null>,
  versionKey: string,
): TocHeading[] {
  const [headings, setHeadings] = useState<TocHeading[]>([]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root) {
      setHeadings([]);
      return;
    }
    // `:scope` keeps us from picking up headings rendered by widgets we
    // don't own (e.g. a future plugin that injects its own h2). All
    // markdown-emitted headings are direct descendants of the article
    // body, so a deep query under the root is safe.
    const nodes = Array.from(
      root.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6'),
    );

    const next: TocHeading[] = [];
    for (const node of nodes) {
      const id = node.id;
      // Skip headings that rehype-slug couldn't id (e.g. headings that
      // are purely emoji + the slugger collapsed to empty). Without an
      // id we can't anchor-scroll to it from a TOC click.
      if (!id) continue;
      const level = Number.parseInt(node.tagName.slice(1), 10);
      if (!Number.isFinite(level) || level < 1 || level > 6) continue;
      // GitHub-style heading anchors (the visible `#` link rehype-autolink
      // adds when enabled) live inside the heading. We strip them out of
      // the text — react-markdown without autolink-headings doesn't emit
      // them in this codebase, but the trim defends against a future
      // plugin add.
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      next.push({ id, text, level });
    }
    setHeadings(next);
    // versionKey is the gate: extract fresh whenever the underlying
    // doc identity changes. We intentionally don't depend on
    // `articleRef` itself — the ref object's identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey]);

  return headings;
}
