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
import { useLightbox } from '../Lightbox/LightboxContext';
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

  // PR-4: pull the lightbox opener from context here (a single hook
  // call at the component root) and close over it inside the overrides
  // factory. The factory is memoized on `open`'s identity (stable
  // across renders thanks to `useCallback` in the provider), so the
  // components prop identity is stable too — the markdown pipeline does
  // NOT re-run on every parent render.
  const { open } = useLightbox();
  const components = useMemo<Components>(() => buildComponents(open), [open]);

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
 * react-markdown component overrides, parameterized on the lightbox
 * opener so the `pre` (Mermaid) + `img` overrides can dispatch into the
 * portal-rendered lightbox without each call site re-invoking
 * `useLightbox()` (react-markdown calls these as plain function
 * components per element; calling hooks inside them would work but adds
 * a hook-rules surface to think about — closure form is simpler).
 *
 * The factory is invoked once per `open` identity change in DocumentView,
 * which is once per app lifetime in practice (the provider stabilizes
 * `open` via `useCallback`).
 */
function buildComponents(openLightbox: (c: import('../Lightbox/LightboxContext').LightboxContent) => void): Components {
  return {
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
        // PR-4: wire the Mermaid Fullscreen button into the lightbox.
        // Mermaid passes the cached SVG string to `onRequestFullscreen`
        // (set up in PR-3); we forward it as a 'svg' content payload
        // so the lightbox can inject it via dangerouslySetInnerHTML
        // without disturbing the inline diagram's DOM.
        return (
          <Mermaid
            source={mermaidSource}
            onRequestFullscreen={(svg) => openLightbox({ kind: 'svg', svg })}
          />
        );
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
    img: ({ src, alt, style, ...props }) => {
      // PR-4: clicking any rendered <img> opens the lightbox. We operate
      // on whatever `src` is set to right now — PR-5 will wire local
      // relative-path resolution via `convertFileSrc`, and at that point
      // the lightbox image path "just works" since it operates on the
      // already-rendered src.
      //
      // The string-guard mirrors react-markdown's image typing: `src` can
      // be undefined for malformed markdown. In that case we render a
      // pass-through img (no click handler) so we don't try to lightbox
      // an empty URL.
      if (typeof src !== 'string' || src === '') {
        // eslint-disable-next-line jsx-a11y/alt-text
        return <img src={src} alt={alt ?? ''} style={style} {...props} />;
      }
      return (
        <img
          src={src}
          alt={alt ?? ''}
          // `cursor: zoom-in` advertises the lightbox affordance. Merge
          // any caller-provided style after our default so user CSS can
          // override (e.g. for thumbnails that should look static).
          style={{ cursor: 'zoom-in', ...style }}
          onClick={() => openLightbox({ kind: 'image', src, alt })}
          {...props}
        />
      );
    },
  };
}
