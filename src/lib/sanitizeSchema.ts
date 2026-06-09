import { defaultSchema } from 'rehype-sanitize';

/**
 * Strict allowlist sanitize schema for raw HTML embedded in markdown
 * documents (task 06-10-raw-html-render).
 *
 * Built by SPREADING rehype-sanitize's GitHub-safe `defaultSchema` and
 * extending ONLY what images / tables / common formatting need. We never
 * mutate `defaultSchema` (it's shared) and spread each per-tag array.
 *
 * Deliberately NOT allowed (security-conservative posture, confirmed with
 * the user 2026-06-09):
 *   - `style` element AND `style=` attribute — the one residual the prod CSP
 *     does NOT block (`style-src` has `'unsafe-inline'`), so a hostile doc
 *     could exfiltrate/track via `background:url(https://attacker/track)`.
 *   - any `on*` event-handler attribute.
 *   - `script` / `iframe` / `object` / `embed` / `form` / `svg` / `math` /
 *     `meta` / `base` / `link` (none are in `defaultSchema.tagNames`, so the
 *     spread already excludes them — we add nothing here).
 *   - `data-*` attributes, EXCEPT `dataMermaidSource` on `<pre>` (our mermaid
 *     pre-tagger sets `data-mermaid-source` BEFORE sanitize runs; whitelist it
 *     so mermaid detection survives — see design.md D2).
 *
 * `defaultSchema.protocols` (href/src limited to http/https/mailto + relative)
 * is preserved via the spread, giving a second layer under react-markdown's
 * `defaultUrlTransform` + our `resolveImageSrc`. Tauri's local-image URLs are
 * `http://asset.localhost/...` (http), so they survive sanitize.
 */
export const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    // Extra non-interactive, script-free formatting elements not already in
    // the GitHub-safe defaults (details/summary/sub/sup/kbd already are).
    'figure',
    'figcaption',
    'mark',
    'abbr',
    'samp',
    'var',
    'dl',
    'dt',
    'dd',
  ],
  attributes: {
    ...defaultSchema.attributes,
    // defaultSchema's img is [...aria, 'longDesc', 'src'] — it does NOT allow
    // alt/title/width/height, so without this every image's alt + dimensions
    // would be stripped.
    img: [...(defaultSchema.attributes?.img ?? []), 'alt', 'title', 'width', 'height', 'loading'],
    // Tables: the `*` wildcard already permits camelCase align/colSpan/rowSpan;
    // add explicit camelCase + lowercase forms (belt-and-suspenders for raw
    // hand-written HTML) plus scope.
    td: [...(defaultSchema.attributes?.td ?? []), 'colSpan', 'rowSpan', 'colspan', 'rowspan', 'align', 'valign'],
    th: [...(defaultSchema.attributes?.th ?? []), 'colSpan', 'rowSpan', 'colspan', 'rowspan', 'align', 'valign', 'scope'],
    col: [...(defaultSchema.attributes?.col ?? []), 'span'],
    colgroup: [...(defaultSchema.attributes?.colgroup ?? []), 'span'],
    details: [...(defaultSchema.attributes?.details ?? []), 'open'],
    // Mermaid pre-tagger writes data-mermaid-source on <pre> before sanitize;
    // keep it so the <pre> → <Mermaid> routing in DocumentView still fires.
    pre: [...(defaultSchema.attributes?.pre ?? []), 'dataMermaidSource'],
    // `title` (tooltip) is harmless and useful on links/abbr; nothing else
    // global is added (no className/style/on*).
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'title'],
  },
};
