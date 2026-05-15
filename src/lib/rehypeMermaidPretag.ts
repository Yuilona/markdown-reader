import type { Element, Properties, Root, RootContent, Text } from 'hast';
import type { Plugin } from 'unified';

/**
 * Pre-Shiki rehype tagging step for Mermaid code blocks (PR-3).
 *
 * Why this plugin exists
 * ----------------------
 * Our Shiki rehype plugin ({@link `markdownPlugins.ts`}) is configured
 * with `fallbackLanguage: 'text'`. Mermaid is NOT a Shiki grammar, so
 * when Shiki encounters `language-mermaid`, it falls back to the `text`
 * grammar and REPLACES the original `<pre><code class="language-mermaid">`
 * node with a new tokenized fragment that has `class="language-text"`.
 *
 * By the time react-markdown invokes our component overrides the
 * original "this is a mermaid block" signal is gone, and the children
 * are nested Shiki spans rather than the raw source.
 *
 * This plugin runs BEFORE Shiki and:
 *   1. Captures the raw mermaid source from the text child.
 *   2. Stashes it on the parent `<pre>` as a `data-mermaid-source`
 *      property (becomes `data-mermaid-source="..."` in the DOM, and
 *      `node.properties.dataMermaidSource` in the override's `node`
 *      prop — react-markdown camel-cases hast `data-*` automatically).
 *   3. Removes `language-mermaid` from the code's className so Shiki
 *      can't extract a lang and short-circuits with `if (!lang) return;`.
 *      The block remains in the tree as a plain `<pre><code>` and the
 *      `pre` override re-routes it to `<Mermaid>` based on the
 *      `data-mermaid-source` marker.
 *
 * Why store the full source as an attribute
 * -----------------------------------------
 * It removes any need to re-walk the tokenized Shiki spans at
 * React-render-time or to round-trip through `hast-util-to-string`.
 * The source is already a string in our hand here; pass it through
 * untouched.
 *
 * Note: we do NOT base64-encode. HTML attributes can hold any character
 * (the serializer will entity-escape `<`, `>`, `&`, `"` as needed) and
 * react-markdown reads via the hast tree, never via DOM string round-
 * tripping, so the original source survives intact.
 */
export const rehypeMermaidPretag: Plugin<[], Root> = () => {
  return (tree) => {
    walk(tree, (node, parent) => {
      if (parent === null) return;
      if (node.type !== 'element') return;
      if (node.tagName !== 'code') return;

      const className = node.properties?.className;
      if (!Array.isArray(className)) return;
      const langClass = className.find(
        (c): c is string => typeof c === 'string' && c.startsWith('language-'),
      );
      if (langClass !== 'language-mermaid') return;

      // Reconstruct the raw mermaid source from the code element's text
      // children. At this stage Shiki hasn't run, so children are a
      // sequence of `text` nodes (typically just one — `mdast-util-to-
      // hast` adds a trailing newline that we strip).
      const source = extractTextChildren(node).replace(/\n$/, '');

      // Drop `language-mermaid` so Shiki can't parse a lang for this
      // block. Other classes (rare) survive.
      const newClass = className.filter((c) => c !== 'language-mermaid');
      node.properties = node.properties ?? {};
      node.properties.className = newClass.length > 0 ? newClass : undefined;

      // The parent `<pre>` is where the override matches (we override
      // `pre`, not `code`). Stash the source there.
      if (parent.type === 'element' && parent.tagName === 'pre') {
        const props: Properties = parent.properties ?? {};
        // We write the kebab-cased key directly. react-markdown is
        // configured with `passNode: true` (via hast-util-to-jsx-runtime),
        // so the override receives the raw hast node and reads
        // `node.properties['data-mermaid-source']` unchanged. The override
        // in DocumentView also tolerates the camelCased `dataMermaidSource`
        // spelling defensively in case a future plugin in the chain
        // normalizes property names.
        props['data-mermaid-source'] = source;
        parent.properties = props;
      }
    });
  };
};

/** Concatenate every `text` descendant's `value` (depth-first). */
function extractTextChildren(node: Element): string {
  let out = '';
  for (const child of node.children) {
    if (isText(child)) {
      out += child.value;
    } else if (child.type === 'element') {
      out += extractTextChildren(child);
    }
  }
  return out;
}

function isText(node: RootContent): node is Text {
  return node.type === 'text';
}

/**
 * Iterative pre-order tree walk. We don't pull in `unist-util-visit`
 * because the dep is only available transitively and the walk is one
 * page of code — adding a top-level dep just for a 12-line traversal
 * isn't worth it.
 */
function walk(
  root: Root,
  visitor: (node: Root | RootContent, parent: Root | Element | null) => void,
): void {
  const stack: Array<{ node: Root | RootContent; parent: Root | Element | null }> = [
    { node: root, parent: null },
  ];
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    visitor(node, parent);
    if (node.type === 'root' || node.type === 'element') {
      const children = node.children;
      // Push in reverse so children are visited in document order.
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        stack.push({ node: child, parent: node });
      }
    }
  }
}
