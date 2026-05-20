import type { Element, Root, Properties } from 'hast';
import type { Plugin } from 'unified';

/**
 * Source-line stamping for editor↔preview line sync (v1.0, R-EDIT-4 +
 * bidirectional click highlight).
 *
 * We stamp `data-source-line="N"` (N = 1-indexed line within the
 * frontmatter-stripped BODY) on every top-level block element so the
 * sync code can map editor lines ↔ preview blocks.
 *
 * Two passes are needed because of Shiki:
 *
 *   `rehypeSourceLine` runs BEFORE Shiki. It stamps each top-level child
 *   that has position info, AND records line-by-index on the tree.
 *
 *   `rehypeSourceLineApply` runs AFTER Shiki. Shiki replaces each code
 *   block's `<pre>` wholesale (`parent.children[i] = fragment`), dropping
 *   the property AND the node's position — so a single pre-Shiki pass
 *   misses code blocks. Because Shiki replaces in place, the child index
 *   is stable, so this pass re-applies the recorded line by index
 *   (descending into the Root fragment Shiki leaves behind to reach the
 *   new `<pre>`). Mermaid blocks and tables/paragraphs are untouched by
 *   Shiki, so they keep their first-pass stamp and this pass no-ops on
 *   them.
 *
 * Components that OWN their `<pre>` rendering (CodeBlock, Mermaid) read
 * the stamped line off their hast `node` and re-emit it onto their
 * wrapper element — see DocumentView's `pre` override.
 */

const LINE_KEY = 'data-source-line';
const MAP_KEY = '__sourceLineByIndex';

type RootWithMap = Root & { [MAP_KEY]?: Record<number, number> };

export const rehypeSourceLine: Plugin<[], Root> = () => {
  return (tree) => {
    const map: Record<number, number> = {};
    tree.children.forEach((node, i) => {
      if (node.type !== 'element') return;
      const line = node.position?.start?.line;
      if (line == null) return;
      const el = node as Element;
      const props: Properties = el.properties ?? {};
      props[LINE_KEY] = line;
      el.properties = props;
      map[i] = line;
    });
    (tree as RootWithMap)[MAP_KEY] = map;
  };
};

export const rehypeSourceLineApply: Plugin<[], Root> = () => {
  return (tree) => {
    const map = (tree as RootWithMap)[MAP_KEY];
    if (!map) return;
    tree.children.forEach((node, i) => {
      const line = map[i];
      if (line == null) return;
      // The node itself (untouched elements) or, for a Shiki-replaced
      // code block, the first element inside the Root fragment.
      let target: Element | null = null;
      if (node.type === 'element') {
        target = node;
      } else if ((node as { type: string }).type === 'root') {
        const frag = node as unknown as Root;
        target = (frag.children.find((c) => c.type === 'element') as Element) ?? null;
      }
      if (!target) return;
      const props: Properties = target.properties ?? {};
      if (props[LINE_KEY] == null) {
        props[LINE_KEY] = line;
        target.properties = props;
      }
    });
  };
};

/** Read the stamped source line off a hast node's properties, tolerating
 *  both the kebab key we write and react-markdown's camelCased spelling.
 *  Returns undefined when absent. Used by the CodeBlock / Mermaid
 *  overrides to re-emit the line onto their wrapper element. */
export function readSourceLine(
  properties: Record<string, unknown> | undefined,
): number | undefined {
  if (!properties) return undefined;
  const raw = properties[LINE_KEY] ?? properties.dataSourceLine;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
