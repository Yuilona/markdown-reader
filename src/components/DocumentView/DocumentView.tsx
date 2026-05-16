import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
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
import { useContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenuContext';
import { useStatusBar } from '../StatusBar/StatusBarContext';
import { useToast } from '../Toast/useToast';
import { openLinkInBrowser, copyLinkAddress, copyImageToClipboard, saveImageToDisk, openImageInSystem } from './documentActions';

// Vendor CSS pulled directly from node_modules — no copy in src/styles
// per the PR-2 brief. Vite resolves these at bundle time.
//
// IMPORT ORDER MATTERS: vendor CSS MUST come BEFORE the CSS Module
// `DocumentView.module.css`. Both `.markdown-body` (from
// github-markdown-css) and our `.article` class are applied to the
// same <article> element; with equal CSS specificity, the LATER
// declaration wins. github-markdown-css explicitly sets
// `.markdown-body { margin: 0 }`, which would otherwise cancel our
// `.article { margin: 0 auto }` and the document would render
// left-aligned instead of centered (R9.4). Keep these imports here.
//
// PR-6: switched from `github-markdown-light.css` to the COMBINED
// `github-markdown.css`. The combined file ships `[data-theme='light']`
// and `[data-theme='dark']` selectors AND a fallback
// `@media (prefers-color-scheme: dark)` rule. Because ThemeProvider sets
// `data-theme` on <html>, the explicit-mode selectors win over the
// media query — so user-forced light mode works even on a dark-OS
// machine, and user-forced dark works on a light-OS machine. Our
// `theme.light.css` / `theme.dark.css` then override its variables
// with our palette tokens for color cohesion.
import 'github-markdown-css/github-markdown.css';
import 'katex/dist/katex.min.css';
import 'remark-github-blockquote-alert/alert.css';

import { CodeBlock } from './CodeBlock';
import { Frontmatter } from './Frontmatter';
import { FrontmatterProvider } from './FrontmatterContext';
import { ImageWithFallback } from './ImageWithFallback';
import { Mermaid } from '../Mermaid/Mermaid';
import { useLightbox } from '../Lightbox/LightboxContext';
import { Toc } from '../Toc/Toc';
import { SearchBar } from '../Search/SearchBar';
import styles from './DocumentView.module.css';

interface DocumentViewProps {
  doc: LoadedDocument;
  /** PR-7: TOC sidebar visibility. Owned by App.tsx (so the Ctrl+\
   *  shortcut can toggle it) and persisted to settings.json there. */
  tocVisible: boolean;
  /** PR-7: invoked when the user toggles the TOC panel (× button or
   *  the floating open-toggle when closed). Flip the visibility +
   *  persist to settings. */
  onToggleToc: () => void;
  /** PR-7: SearchBar visibility. Owned by App.tsx. */
  searchOpen: boolean;
  /** PR-7: invoked when the user closes the SearchBar via Esc / × button. */
  onCloseSearch: () => void;
  /** PR-7: ref to the SearchBar's input field, forwarded from App.tsx so
   *  the Ctrl+F handler can re-focus + select on a second open. */
  searchInputRef: RefObject<HTMLInputElement>;
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
 *
 * PR-7: mounts the TOC sidebar + SearchBar overlay. Both share the
 * scrollRef (the IntersectionObserver's root, and the article-walk
 * scope) and articleRef (the heading-extraction + match-walking root).
 * FrontmatterProvider wraps the article so the SearchBar can read the
 * frontmatter open-state for R8.10's "search frontmatter only when
 * expanded" rule.
 */
const rehypePluginsWithMermaid: PluggableList = [rehypeMermaidPretag, ...rehypePlugins];

export function DocumentView({
  doc,
  tocVisible,
  onToggleToc,
  searchOpen,
  onCloseSearch,
  searchInputRef,
}: DocumentViewProps) {
  const { frontmatterRaw, body } = useMemo(() => {
    const split = splitFrontmatter(doc.text);
    if (split) return { frontmatterRaw: split.raw, body: split.body };
    return { frontmatterRaw: '', body: doc.text };
  }, [doc.text]);

  // Scroll container ref — owned here, shared with the scroll-memory hook,
  // the TOC observer's `root`, and the SearchBar (indirectly, via the
  // articleRef descendant).
  // The element it points to is stable across `doc.text` changes (the
  // watcher reload re-renders children but keeps `.scrollArea` mounted),
  // so the scroll Y survives the swap naturally.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Article ref — root for heading extraction (TOC) AND match walking
  // (SearchBar). Pointing at the same `<article>` element keeps both
  // features scope-consistent: neither one sees Mermaid/KaTeX subtrees
  // outside the article body.
  const articleRef = useRef<HTMLElement | null>(null);
  useScrollMemory(scrollRef, doc.path);

  // Pull the lightbox opener + link router context once at the component
  // root and close over them in the components factory. Both providers'
  // values are stabilized with `useCallback`/`useMemo` so the factory
  // memo holds across re-renders → the markdown pipeline doesn't re-run
  // on every parent render.
  const { open, isOpen: lightboxOpen } = useLightbox();
  const linkRouter = useLinkRouter();
  // PR-8: context-menu + status-bar + toast contexts. All three are
  // stable in identity (their providers memoize the value object) so
  // including them in the buildComponents memo's dep array is cheap.
  const ctxMenu = useContextMenu();
  const statusBar = useStatusBar();
  const toast = useToast();
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

  // PR-8: right-click on a link (R7.7) — show context menu with "复制
  //链接地址" and "在浏览器中打开". The menu suppresses the browser's
  // default contextmenu via the event preventDefault.
  const onLinkContextMenu = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      event.preventDefault();
      const items: ContextMenuItem[] = [
        {
          label: '复制链接地址',
          onClick: () => void copyLinkAddress(href, toast),
        },
        {
          label: '在浏览器中打开',
          onClick: () => void openLinkInBrowser(href, toast),
        },
      ];
      ctxMenu.open(event.clientX, event.clientY, items);
    },
    [ctxMenu, toast],
  );

  // PR-8: right-click on an image (R6.7, R14.5).
  const onImageContextMenu = useCallback(
    (
      event: React.MouseEvent<HTMLElement>,
      resolvedSrc: string | undefined,
      altText: string,
      originalSrc: string | undefined,
    ) => {
      // No resolved src → no useful actions (placeholder doesn't have a
      // copyable URL). Let the browser show its default menu.
      if (!resolvedSrc) return;
      event.preventDefault();
      const filenameGuess =
        originalSrc?.split(/[/\\]/).pop()?.split('?')[0] ||
        (altText ? `${altText}.png` : 'image.png');
      const items: ContextMenuItem[] = [
        {
          label: '复制图片',
          onClick: () => void copyImageToClipboard(resolvedSrc, toast),
        },
        {
          label: '另存为…',
          onClick: () => void saveImageToDisk(resolvedSrc, filenameGuess, toast),
        },
        {
          label: '在系统中打开',
          onClick: () => void openImageInSystem(resolvedSrc, toast),
        },
      ];
      ctxMenu.open(event.clientX, event.clientY, items);
    },
    [ctxMenu, toast],
  );

  const components = useMemo<Components>(
    () => buildComponents({
      openLightbox: open,
      onLinkClick,
      onLinkContextMenu,
      onImageContextMenu,
      docDir,
    }),
    [open, onLinkClick, onLinkContextMenu, onImageContextMenu, docDir],
  );

  // PR-8: delegated mouseover/mouseout for status-bar URL hover (R7.6).
  // Attaching a single listener on the article (rather than per-<a>)
  // avoids:
  //   - blowing up the components factory's memoization
  //   - per-link React re-renders for hover state
  //
  // We walk up from event.target until we find an <a> with an href, then
  // call setStatusText(href). On mouseout (without an enter into another
  // anchor), clear via setStatusText(null).
  //
  // Dep array uses the STABLE `setStatusText` (the context's useCallback-
  // wrapped setter) NOT the whole `statusBar` value object. The value
  // object's identity changes on every `text` update (i.e. every hover),
  // which would otherwise re-bind the listener on every hover.
  const setStatusText = statusBar.setText;
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const findAnchor = (el: EventTarget | null): HTMLAnchorElement | null => {
      let cur = el as Node | null;
      while (cur && cur !== article) {
        if (cur instanceof HTMLAnchorElement && cur.getAttribute('href')) {
          return cur;
        }
        cur = cur.parentNode;
      }
      return null;
    };
    const onOver = (e: MouseEvent) => {
      const anchor = findAnchor(e.target);
      if (anchor) {
        // Display the original href (not the resolved URL) — that's what
        // the user clicks and what makes sense as "anti-phishing"
        // information per R7.6.
        setStatusText(anchor.getAttribute('href'));
      }
    };
    const onOut = (e: MouseEvent) => {
      // When the mouse moves from one anchor to another, relatedTarget
      // will be inside the new anchor — let onOver handle the swap.
      // Only clear when leaving an anchor for non-anchor space.
      const fromAnchor = findAnchor(e.target);
      const toAnchor = findAnchor(e.relatedTarget);
      if (fromAnchor && !toAnchor) {
        setStatusText(null);
      }
    };
    article.addEventListener('mouseover', onOver);
    article.addEventListener('mouseout', onOut);
    return () => {
      article.removeEventListener('mouseover', onOver);
      article.removeEventListener('mouseout', onOut);
      // Defensive clear so a stray "last link" text doesn't survive
      // unmounting the article.
      setStatusText(null);
    };
    // Re-bind whenever the doc swaps — articleRef points at a new DOM
    // element each time, and we want our listener on the fresh one.
  }, [doc.path, doc.text, setStatusText]);

  // Re-extraction trigger for TOC + re-walk trigger for SearchBar. We
  // need a value that changes whenever the article DOM has been
  // replaced: doc swap (`doc.path`) OR watcher reload (`doc.text`).
  //
  // The dep array `[doc.path, doc.text]` already covers both cases:
  // `loadDocument` always returns a fresh `LoadedDocument`, so on every
  // reload the `doc.text` reference is new — even when the file
  // contents happen to be identical. Using a monotonic counter (bumped
  // each time the memo re-runs) produces a small, distinct string for
  // every load, which downstream `useEffect`s key off cheaply. This
  // sidesteps the "identical length but different content" trap that a
  // `${path}::${length}` key would silently ignore.
  const versionCounterRef = useRef(0);
  const tocVersionKey = useMemo(
    () => {
      versionCounterRef.current += 1;
      return `${doc.path}::${versionCounterRef.current}`;
    },
    [doc.path, doc.text],
  );

  return (
    <FrontmatterProvider resetKey={doc.path}>
      <div ref={scrollRef} className={styles.scrollArea}>
        <article ref={articleRef} className={`${styles.article} markdown-body`}>
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
      <Toc
        articleRef={articleRef}
        scrollRef={scrollRef}
        versionKey={tocVersionKey}
        visible={tocVisible}
        onClose={onToggleToc}
        onOpen={onToggleToc}
        searchOpen={searchOpen}
      />
      <SearchBar
        articleRef={articleRef}
        open={searchOpen}
        onClose={onCloseSearch}
        lightboxOpen={lightboxOpen}
        inputRef={searchInputRef}
        versionKey={tocVersionKey}
      />
    </FrontmatterProvider>
  );
}

interface BuildComponentsOptions {
  openLightbox: (c: import('../Lightbox/LightboxContext').LightboxContent) => void;
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** PR-8: link right-click context menu (R7.7). */
  onLinkContextMenu: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** PR-8: image right-click context menu (R6.7, R14.5). */
  onImageContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    resolvedSrc: string | undefined,
    altText: string,
    originalSrc: string | undefined,
  ) => void;
  /** Directory of the current document (for resolving relative image paths). */
  docDir: string;
}

/**
 * react-markdown component overrides. Plain functions so they keep stable
 * identity per memoized factory call.
 */
function buildComponents(opts: BuildComponentsOptions): Components {
  const { openLightbox, onLinkClick, onLinkContextMenu, onImageContextMenu, docDir } = opts;
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
        <a
          href={href}
          {...rest}
          onClick={(e) => onLinkClick(e, href)}
          onContextMenu={(e) => onLinkContextMenu(e, href)}
        >
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
      const onContextMenu = (event: React.MouseEvent<HTMLElement>) => {
        onImageContextMenu(event, resolvedSrc, altText, rawSrc);
      };
      return (
        <ImageWithFallback
          resolvedSrc={resolvedSrc}
          alt={altText}
          originalSrc={rawSrc}
          onClick={onClick}
          onContextMenu={onContextMenu}
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
