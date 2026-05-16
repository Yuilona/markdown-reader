import { createContext, useContext } from 'react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

import { dirname, isMarkdownPath, normalizePath } from './pathUtils';

/**
 * R7 link routing (PR-5b).
 *
 * Five cases, exhaustively handled below:
 *   1. Anchor / hash-only (`#heading`): smooth-scroll within doc.
 *   2. External http(s): `shell.open` → system default browser.
 *   3. mailto/tel/etc: `shell.open` → system default handler.
 *   4. Local `.md` / `.markdown`: load in current window via
 *      `LinkRouterContext.openDocument` (App.tsx wires this to the
 *      shared `setDocFromPath` so recent.json + watcher + scroll
 *      memory all update through the canonical funnel).
 *   5. Local other file: `shell.open(absolutePath)` → system default app.
 *
 * Any thrown error from `shellOpen` is caught and surfaced via the
 * provided `onError(message)` callback, which App.tsx hooks to the
 * existing dropError-style 3-second banner (PR-5a). PR-8 will replace
 * that banner with a real toast system.
 */

export interface LinkRouterContextValue {
  /** Load a local .md/.markdown file in the current window. App.tsx
   *  wires this to `setDocFromPath`. */
  openDocument: (absolutePath: string) => void;
  /** Surface a user-friendly error message (e.g. "无法打开链接"). */
  onError: (message: string) => void;
}

export const LinkRouterContext = createContext<LinkRouterContextValue | null>(null);

/**
 * Hook for `<a>` overrides + tests. Returns null when no provider is
 * mounted so the caller can fall back to a permissive default (e.g. the
 * empty state — we'll never render an `<a>` there in practice). Throwing
 * here would hurt incremental testing.
 */
export function useLinkRouter(): LinkRouterContextValue | null {
  return useContext(LinkRouterContext);
}

/** Result of classifying a raw href. */
export type LinkKind =
  | { kind: 'anchor'; id: string }
  | { kind: 'http'; href: string }
  | { kind: 'protocol'; href: string }
  | { kind: 'local-md'; absolutePath: string }
  | { kind: 'local-other'; absolutePath: string }
  | { kind: 'empty' };

const PROTOCOL_PREFIXES = ['mailto:', 'tel:', 'sms:', 'ftp:', 'ftps:'];

/**
 * Classify a raw href into one of the five link kinds. `docPath` is the
 * absolute path of the currently-open document (used to resolve relative
 * local paths). When `docPath` is empty, relative paths are treated as
 * empty (we can't resolve them).
 */
export function classifyLink(href: string, docPath: string): LinkKind {
  const trimmed = href.trim();
  if (trimmed === '') return { kind: 'empty' };

  if (trimmed.startsWith('#')) {
    return { kind: 'anchor', id: decodeURIComponent(trimmed.slice(1)) };
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { kind: 'http', href: trimmed };
  }
  for (const prefix of PROTOCOL_PREFIXES) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return { kind: 'protocol', href: trimmed };
    }
  }

  // Local path — absolute or relative.
  const abs = resolveLocalPath(trimmed, docPath);
  if (!abs) return { kind: 'empty' };
  return isMarkdownPath(abs)
    ? { kind: 'local-md', absolutePath: abs }
    : { kind: 'local-other', absolutePath: abs };
}

/**
 * Resolve a (possibly relative) local path against `docPath`'s directory.
 * Returns `null` if the input is empty after percent-decoding.
 *
 * Heuristics:
 *   - Absolute Windows path: starts with a drive letter `C:\` / `C:/` OR
 *     a UNC `\\server\...` prefix.
 *   - POSIX absolute (`/foo/bar`): treated as absolute (the user wrote
 *     it that way; converting it on Windows would be wrong).
 *   - Otherwise: relative — join with `dirname(docPath)`.
 *
 * URL fragments (`#section`) on a local path are stripped — the file is
 * loaded, anchor handling inside it is a v0.2 concern.
 */
function resolveLocalPath(rawHref: string, docPath: string): string | null {
  // Strip any `?query` and `#fragment` portion — local files don't use them.
  let href = rawHref;
  const hashIdx = href.indexOf('#');
  if (hashIdx >= 0) href = href.slice(0, hashIdx);
  const qIdx = href.indexOf('?');
  if (qIdx >= 0) href = href.slice(0, qIdx);

  // Markdown authors typically write percent-encoded paths only when there
  // are spaces. Try to decode; fall back to raw on malformed input.
  let decoded = href;
  try {
    decoded = decodeURI(href);
  } catch {
    decoded = href;
  }
  if (decoded === '') return null;

  // Detect absolute paths.
  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(decoded) || decoded.startsWith('\\\\');
  const isPosixAbs = decoded.startsWith('/');
  if (isWinAbs) {
    return normalizePath(decoded);
  }
  if (isPosixAbs) {
    // On Windows, a leading `/` is unusual but the user wrote it; preserve
    // as-is after normalization (slashes flipped to backslashes).
    return normalizePath(decoded);
  }

  // Relative — needs a docPath to resolve against.
  if (!docPath) return null;
  const base = dirname(docPath);
  if (!base) return null;
  // Naive join: backslash separator. We don't collapse `..` or `.` here
  // — the OS-level file open will follow them correctly. If the user
  // wrote `../foo/bar.md`, that's fine; the system sees it the same.
  return normalizePath(`${base}\\${decoded}`);
}

/** Smooth-scroll within the current document to the heading with the
 *  given slug. No-op if not found (we don't show an error for a missing
 *  anchor — that's normal in drafts and the in-doc nav is best-effort). */
function scrollToAnchor(id: string): void {
  if (!id) return;
  // `getElementById` doesn't accept percent-decoded ids if the slug
  // generator stored them otherwise — try the raw, then a lowercased
  // variant (rehype-slug's typical normalization).
  const el =
    document.getElementById(id) ?? document.getElementById(id.toLowerCase());
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Click handler factory. Returns the event listener you attach to an
 * `<a>` tag. Pulls the open-document callback + error sink from the
 * `LinkRouterContext` provided by App.tsx.
 *
 * The factory pattern (rather than a hook called inside each `<a>`)
 * keeps the markdown pipeline's component-overrides plain functions
 * with stable identities — same approach as the lightbox `open` closure
 * in `DocumentView.buildComponents`.
 */
export async function handleLinkClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
  ctx: { docPath: string; openDocument: (p: string) => void; onError: (msg: string) => void },
): Promise<void> {
  // Always intercept — we route every link ourselves.
  event.preventDefault();
  // Modifier-clicks (Ctrl/Shift/Middle) behave the same as plain click in
  // a single-window app: there's no concept of "new tab" here. Treat
  // uniformly.

  const classified = classifyLink(href, ctx.docPath);
  switch (classified.kind) {
    case 'empty':
      return;
    case 'anchor':
      scrollToAnchor(classified.id);
      return;
    case 'http':
    case 'protocol':
      try {
        await shellOpen(classified.href);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[markdown-reader] failed to open external link:', classified.href, err);
        ctx.onError('无法打开链接');
      }
      return;
    case 'local-md':
      ctx.openDocument(classified.absolutePath);
      return;
    case 'local-other':
      try {
        await shellOpen(classified.absolutePath);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[markdown-reader] failed to open local file:',
          classified.absolutePath,
          err,
        );
        ctx.onError('无法打开文件');
      }
      return;
  }
}
