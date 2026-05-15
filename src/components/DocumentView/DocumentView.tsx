import { useMemo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { PluggableList } from 'unified';

import { remarkPlugins, rehypePlugins } from '../../lib/markdownPlugins';
import { rehypeMermaidPretag } from '../../lib/rehypeMermaidPretag';
import { splitFrontmatter } from '../../lib/parseFrontmatter';
import type { LoadedDocument } from '../../lib/tauri';

import { CodeBlock } from './CodeBlock';
import { Frontmatter } from './Frontmatter';
import { Mermaid } from '../Mermaid/Mermaid';
import styles from './DocumentView.module.css';

// Vendor CSS pulled directly from node_modules — no copy in src/styles
// per the PR-2 brief. Vite resolves these at bundle time.
import 'github-markdown-css/github-markdown-light.css';
import 'katex/dist/katex.min.css';
import 'remark-github-blockquote-alert/alert.css';

interface DocumentViewProps {
  doc: LoadedDocument;
}

/**
 * Renders a loaded markdown document.
 *
 * Pipeline:
 *   1. Split off YAML frontmatter via `parseFrontmatter` (the simplest
 *      synchronous approach — see the file's header comment).
 *   2. Pass the frontmatter-less body to `<Markdown>` with the shared
 *      remark + rehype plugin chain (math, GFM, alerts, Shiki).
 *   3. Wrap the result in `<article class="markdown-body">` so
 *      `github-markdown-css` styles apply.
 *   4. Layout: 820px max-width, centered, with comfortable padding
 *      (R9.4 — establishes the typography frame PR-6 will polish).
 *
 * Component overrides (PR-2 scope only):
 *   - `pre` → CodeBlock wrapper with language label + Copy button.
 *   - `input` → forced disabled (R3.9: task list checkboxes are
 *     non-interactive in a reader).
 *   - `a`, `img` → minimal pass-through; routing/lightbox land in PR-5
 *     and PR-4 respectively.
 *
 * Admonitions: `remark-github-blockquote-alert` already emits a `<div>`
 * with `class="markdown-alert markdown-alert-<type>"` and an inner
 * `.markdown-alert-title` paragraph WITH an inline SVG icon. We import
 * the plugin's own `alert.css` above to get the GitHub-style border /
 * tinted text without re-implementing the icon list. No `Admonition.tsx`
 * is needed; the CSS-only route is the cleanest fit here.
 */
/**
 * Rehype plugin chain assembled with our Mermaid pre-tagger PREPENDED.
 *
 * `rehypeMermaidPretag` MUST run before Shiki (which lives in
 * `markdownPlugins.ts`'s `rehypePlugins`). Shiki rewrites code blocks
 * whose language is unknown into a tokenized fragment that loses the
 * original `language-mermaid` class — by the time the React layer sees
 * the tree, the "this is mermaid" signal is gone. Pre-tagging stashes
 * the source on the `<pre>` so the override can route to `<Mermaid>`.
 *
 * Declared at module scope so the array identity is stable across
 * re-renders (avoids re-running the markdown pipeline because
 * `rehypePlugins` "changed").
 */
const rehypePluginsWithMermaid: PluggableList = [rehypeMermaidPretag, ...rehypePlugins];

export function DocumentView({ doc }: DocumentViewProps) {
  const { frontmatterRaw, body } = useMemo(() => {
    const split = splitFrontmatter(doc.text);
    if (split) return { frontmatterRaw: split.raw, body: split.body };
    return { frontmatterRaw: '', body: doc.text };
  }, [doc.text]);

  return (
    <div className={styles.scrollArea}>
      <article className={`${styles.article} markdown-body`}>
        <Frontmatter raw={frontmatterRaw} />
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePluginsWithMermaid}
          components={components}
        >
          {body}
        </Markdown>
      </article>
    </div>
  );
}

/**
 * react-markdown component overrides. Declared at module scope so the
 * object identity is stable across re-renders (avoids re-running the
 * markdown pipeline because the components prop "changed").
 */
const components: Components = {
  pre: ({ children, node }) => {
    // PR-3: mermaid blocks are pre-tagged by `rehypeMermaidPretag` with
    // a `data-mermaid-source` attribute carrying the raw source. When
    // present, route to `<Mermaid>` instead of `<CodeBlock>`.
    // react-markdown is configured (via hast-util-to-jsx-runtime's
    // `passNode: true`) to forward the raw hast node, so the property
    // appears under the same key we wrote — kebab `data-mermaid-source`.
    // The camelCase `dataMermaidSource` branch is a defensive fallback
    // in case a future rehype plugin in the chain normalizes property
    // names.
    const props = node?.properties as
      | { dataMermaidSource?: unknown; ['data-mermaid-source']?: unknown }
      | undefined;
    const mermaidSource =
      typeof props?.['data-mermaid-source'] === 'string'
        ? props['data-mermaid-source']
        : typeof props?.dataMermaidSource === 'string'
          ? props.dataMermaidSource
          : null;
    if (mermaidSource !== null) {
      return <Mermaid source={mermaidSource} />;
    }
    return <CodeBlock>{children}</CodeBlock>;
  },
  input: ({ ...props }) => {
    // GFM task list items render as <input type="checkbox">. Force them
    // disabled so users cannot toggle (R3.9 — this is a reader, not an
    // editor). `defaultChecked` from the plugin still wins for visual.
    if (props.type === 'checkbox') {
      return <input {...props} disabled />;
    }
    return <input {...props} />;
  },
  a: ({ children, href, ...props }) => (
    // PR-2: external-friendly default. PR-5 will replace this with the
    // proper R7 routing (system browser / shell.open / in-app md nav).
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
  img: ({ ...props }) => (
    // PR-2: pass through. PR-4 hooks lightbox click; PR-5 resolves
    // local relative paths via Tauri's convertFileSrc.
    // eslint-disable-next-line jsx-a11y/alt-text
    <img {...props} />
  ),
};
