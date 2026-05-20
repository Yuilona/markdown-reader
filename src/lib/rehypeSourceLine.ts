import type { Element, Properties, Root } from 'hast';
import type { Plugin } from 'unified';

/**
 * Stamp `data-source-line="N"` on every top-level block element (v1.0
 * PR-B, R-EDIT-4.3).
 *
 * N is the 1-indexed source line of the block within the markdown BODY
 * that react-markdown received — i.e. AFTER frontmatter has been
 * stripped by `splitFrontmatter`. The scroll-sync hook adds the
 * frontmatter line offset back when translating an editor cursor line
 * (which is relative to the full buffer) into a body line.
 *
 * We only stamp the root's direct children: those are the document's
 * block-level elements (headings, paragraphs, lists, blockquotes, pre,
 * tables, …). The scroll-sync lookup does a "closest preceding block"
 * search, so stamping the top level is enough — and it keeps the DOM
 * uncluttered vs. stamping every nested node.
 *
 * Positions survive the rest of the rehype chain (Shiki rewrites a
 * `<pre>`'s inner tokens but not the `<pre>` element's own properties),
 * so plugin order is not load-bearing — we run first defensively.
 */
export const rehypeSourceLine: Plugin<[], Root> = () => {
  return (tree) => {
    for (const node of tree.children) {
      if (node.type !== 'element') continue;
      const line = node.position?.start?.line;
      if (line == null) continue;
      const el = node as Element;
      const props: Properties = el.properties ?? {};
      // Kebab key written directly — matches the rehypeMermaidPretag
      // convention so it lands in the DOM as `data-source-line`.
      props['data-source-line'] = line;
      el.properties = props;
    }
  };
};
