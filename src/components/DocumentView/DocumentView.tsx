import { useCallback, useMemo, useRef } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import { convertFileSrc } from '@tauri-apps/api/core';

import { remarkPlugins, rehypePlugins } from '../../lib/markdownPlugins';
import { rehypeMermaidPretag } from '../../lib/rehypeMermaidPretag';
import { splitFrontmatter } from '../../lib/parseFrontmatter';
import { dirname, normalizePath } from '../../lib/pathUtils';
import { handleLinkClick, useLinkRouter } from '../../lib/linkRouter';
import type { LoadedDocument } from '../../lib/tauri';
import { useScrollMemory } from '../../hooks/useScrollMemory';

import { CodeBlock } from './CodeBlock';
import { Frontmatter } from './Frontmatter';
import { ImageWithFallback } from './ImageWithFallback';
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
 *   1. Split off YAML frontmatter via `parseFrontmatter`.
 *   2. Pass the frontmatter-less body to `<Markdown>` with the shared
 *      remark + rehype plugin chain (math, GFM, alerts, Shiki).
 *   3. Wrap the result in `<article class="markdown-body">` so
 *      `github-markdown-css` styles apply.
 *   4. Layout: 820px max-width, centered, with comfortable padding
 *      (R9.4 — establishes the typography frame PR-6 will polish).
 *
 * Component overrides:
 *   - `pre` → CodeBlock wrapper with language label + Copy button,
 *     OR `<Mermaid>` when the rehype pre-tagger flagged it.
 *   - `input` → forced disabled (R3.9: task list checkboxes are
 *     non-interactive in a reader).
 *   - `a` → routes via `linkRouter` (R7): anchor / http(s) / mailto /
 *     local .md / local other.
 *   - `img` → resolves the src (R6.1/R6.2 local path → asset://) and
 *     renders `<ImageWithFallback>` which handles R6.4 (lazy),
 *     R6.5 (failure placeholder), R6.6 (alt as title), and dispatches
 *     to the PR-4 lightbox on click.
 *
 * Scroll memory (R10.4): the scroll container ref is passed to
 * `useScrollMemory`, which restores the saved Y when the doc changes
 * and debounce-saves on every scroll. The container element stays
 * mounted across watcher-fired re-renders, so external auto-reload
 * (R2.6) preserves the user's scroll position naturally.
 */
const rehypePluginsWithMermaid: PluggableList = [rehypeMermaidPretag, ...rehypePlugins];

export function DocumentView({ doc }: DocumentViewProps) {
  const { frontmatterRaw, body } = useMemo(() => {
    const split = splitFrontmatter(doc.text);
    if (split) return { frontmatterRaw: split.raw, body: split.body };
    return { frontmatterRaw: '', body: doc.text };
  }, [doc.text]);

  // Scroll container ref — owned here, shared with the scroll-memory hook.
  // The element it points to is stable across `doc.text` changes (the
  // watcher reload re-renders children but keeps `.scrollArea` mounted),
  // so the scroll Y survives the swap naturally.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useScrollMemory(scrollRef, doc.path);

  // Pull the lightbox opener + link router context once at the component
  // root and close over them in the components factory. Both providers'
  // values are stabilized with `useCallback`/`useMemo` so the factory
  // memo holds across re-renders → the markdown pipeline doesn't re-run
  // on every parent render.
  const { open } = useLightbox();
  const linkRouter = useLinkRouter();
  const docDir = useMemo(() => dirname(doc.path), [doc.path]);
  const docPath = doc.path;

  const onLinkClick = useCallback(
    async (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      // When mounted outside <LinkRouterProvider> we fall through to the
      // default browser behavior. In practice App.tsx always mounts the
      // provider; this guard is defensive.
      if (!linkRouter) return;
      await handleLinkClick(event, href, {
        docPath,
        openDocument: linkRouter.openDocument,
        onError: linkRouter.onError,
      });
    },
    [linkRouter, docPath],
  );

  const components = useMemo<Components>(
    () => buildComponents({ openLightbox: open, onLinkClick, docDir }),
    [open, onLinkClick, docDir],
  );

  return (
    <div ref={scrollRef} className={styles.scrollArea}>
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

interface BuildComponentsOptions {
  openLightbox: (c: import('../Lightbox/LightboxContext').LightboxContent) => void;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** Directory of the current document (for resolving relative image paths). */
  docDir: string;
}

/**
 * react-markdown component overrides. Plain functions so they keep stable
 * identity per memoized factory call.
 */
function buildComponents(opts: BuildComponentsOptions): Components {
  const { openLightbox, onLinkClick, docDir } = opts;
  return {
    pre: ({ children, node }) => {
      // Mermaid blocks are pre-tagged by `rehypeMermaidPretag` with a
      // `data-mermaid-source` attribute. When present, route to <Mermaid>
      // instead of <CodeBlock>.
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
      // disabled (R3.9).
      if (props.type === 'checkbox') {
        return <input {...props} disabled />;
      }
      return <input {...props} />;
    },
    a: ({ children, href, ...rest }) => {
      // No href / malformed: render a plain inert span-style anchor.
      if (typeof href !== 'string' || href === '') {
        return <a {...rest}>{children}</a>;
      }
      return (
        <a href={href} {...rest} onClick={(e) => onLinkClick(e, href)}>
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      // Resolve the src; convert local paths via `convertFileSrc`. The
      // resolver handles undefined / absolute / relative / http / data:
      // cases — see `resolveImageSrc` below.
      const rawSrc = typeof src === 'string' ? src : undefined;
      const resolvedSrc = resolveImageSrc(rawSrc, docDir);
      const altText = alt ?? '';
      // Open lightbox on click — skip when there's no resolved src so we
      // don't lightbox a broken/empty URL.
      const onClick = resolvedSrc
        ? () => openLightbox({ kind: 'image', src: resolvedSrc, alt: altText })
        : undefined;
      return (
        <ImageWithFallback
          resolvedSrc={resolvedSrc}
          alt={altText}
          originalSrc={rawSrc}
          onClick={onClick}
        />
      );
    },
  };
}

/**
 * Resolve a markdown `<img src>` to a URL the WebView can load.
 *
 *   - empty / undefined → undefined (caller renders placeholder).
 *   - data: / blob: / http(s): → return as-is (R6.3).
 *   - absolute local path (Windows `C:\...` / `/...` / UNC) → convertFileSrc.
 *   - relative local path → resolve against `docDir`, then convertFileSrc.
 *
 * `convertFileSrc` (from @tauri-apps/api/core) returns
 * `https://asset.localhost/<path>` on Windows. Our CSP already allows
 * `img-src https: asset: https://asset.localhost`, and tauri.conf.json's
 * `assetProtocol.enable: true` enables the underlying scheme.
 *
 * exported for unit testing if/when we ship one.
 */
export function resolveImageSrc(src: string | undefined, docDir: string): string | undefined {
  if (!src) return undefined;
  const trimmed = src.trim();
  if (!trimmed) return undefined;

  // Pass-through schemes.
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }

  // Decode percent-encoding the markdown author may have applied (e.g.
  // `images/my%20pic.png`). Fall back to raw on malformed input.
  let decoded = trimmed;
  try {
    decoded = decodeURI(trimmed);
  } catch {
    decoded = trimmed;
  }

  // Detect absolute paths. On Windows: drive-letter (`C:\` / `C:/`) or
  // UNC (`\\server\share`). On POSIX-style writers: leading `/`.
  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(decoded) || decoded.startsWith('\\\\');
  const isPosixAbs = decoded.startsWith('/');

  let absolute: string;
  if (isWinAbs || isPosixAbs) {
    absolute = normalizePath(decoded);
  } else {
    if (!docDir) {
      // No doc context to resolve against (e.g. browsing without an
      // open file — shouldn't happen in practice). Bail to undefined
      // so the placeholder shows.
      return undefined;
    }
    absolute = normalizePath(`${docDir}\\${decoded}`);
  }

  return convertFileSrc(absolute);
}
