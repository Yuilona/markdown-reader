import type { Element, Root } from 'hast';
import type { Plugin } from 'unified';
import { getAlertIcon } from 'remark-github-blockquote-alert';

/**
 * Re-adds the octicon to GitHub alert titles (`> [!NOTE]` etc.).
 *
 * remark-github-blockquote-alert emits the icon as an inline `<svg>`, but
 * our sanitize schema deliberately allows no `<svg>` from documents, so it
 * is stripped. This plugin runs AFTER sanitize and rebuilds the icon from
 * the plugin's own path data — trusted markup we generate, never anything
 * taken from the document — so alerts look exactly as upstream intends
 * (`alert.css` targets `.markdown-alert-title svg.octicon`).
 */

type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const TYPE_CLASS = /^markdown-alert-(note|tip|important|warning|caution)$/;

function classList(node: Element): string[] {
  const c = node.properties?.className;
  return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(/\s+/) : [];
}

function iconPath(type: AlertType): string {
  // getAlertIcon returns an mdast stub whose single child carries the `d`.
  const icon = getAlertIcon(type) as unknown as {
    children: Array<{ data: { hProperties: { d: string } } }>;
  };
  return icon.children[0]?.data.hProperties.d ?? '';
}

function buildIcon(type: AlertType): Element {
  return {
    type: 'element',
    tagName: 'svg',
    properties: {
      className: ['octicon'],
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      ariaHidden: 'true',
    },
    children: [{ type: 'element', tagName: 'path', properties: { d: iconPath(type) }, children: [] }],
  };
}

export const rehypeAlertIcons: Plugin<[], Root> = () => (tree) => {
  const visit = (node: Root | Element): void => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (child.tagName === 'div') {
        const type = classList(child).map((c) => TYPE_CLASS.exec(c)?.[1]).find(Boolean) as
          | AlertType
          | undefined;
        const title = type
          ? child.children.find(
              (n): n is Element =>
                n.type === 'element' && classList(n).includes('markdown-alert-title'),
            )
          : undefined;
        if (type && title && !title.children.some((n) => n.type === 'element' && n.tagName === 'svg')) {
          title.children.unshift(buildIcon(type));
        }
      }
      visit(child);
    }
  };
  visit(tree);
};
