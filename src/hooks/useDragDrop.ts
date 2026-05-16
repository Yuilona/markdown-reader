import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { isMarkdownPath } from '../lib/pathUtils';

interface UseDragDropOptions {
  /** Called with the first valid .md / .markdown path from the drop. */
  onValidDrop: (path: string) => void;
  /**
   * Called when the user drops something but none of the files have a
   * supported extension. App.tsx surfaces this as a 3-second banner.
   */
  onInvalidDrop?: () => void;
  /** Called on `enter` / `leave` so callers can render a hover overlay. */
  onHoverChange?: (hovering: boolean) => void;
}
/**
 * Subscribe to the Tauri 2 webview drag-drop event for the lifetime of
 * the component.
 *
 * NOTE: Tauri's drag-drop is at the webview level, NOT the React DOM. The
 * old HTML5 `onDragOver`/`onDrop` handlers in EmptyState never fired with
 * actual file paths because Tauri intercepts the OS drop before the
 * browser sees it. The webview event payload has phases:
 *   - `'enter'` / `'over'` / `'leave'` — paths only present on `enter`.
 *   - `'drop'`  — final, with `event.payload.paths: string[]`.
 *
 * Behavior:
 *   - On drop, filter to .md / .markdown. If at least one is valid, load
 *     the FIRST one (R2.1: single-file viewer, no tabs even on multi-drop).
 *   - If zero valid files, fire `onInvalidDrop` so the host can show
 *     a rejection banner (R2.7).
 *   - Works regardless of whether a document is already open — drop on
 *     EmptyState OR on DocumentView (R2.2: drop replaces current).
 */
export function useDragDrop(options: UseDragDropOptions): void {
  const { onValidDrop, onInvalidDrop, onHoverChange } = options;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        switch (payload.type) {
          case 'enter':
            onHoverChange?.(true);
            break;
          case 'over':
            // Continuous hover events — don't toggle state on each one,
            // 'enter' already turned the indicator on.
            break;
          case 'leave':
            onHoverChange?.(false);
            break;
          case 'drop': {
            onHoverChange?.(false);
            const mdPaths = payload.paths.filter(isMarkdownPath);
            if (mdPaths.length > 0) {
              onValidDrop(mdPaths[0]);
            } else if (payload.paths.length > 0) {
              onInvalidDrop?.();
            }
            break;
          }
        }
      })
      .then((un) => {
        if (cancelled) {
          un();
        } else {
          unlisten = un;
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[markdown-reader] failed to register drag-drop listener:', err);
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [onValidDrop, onInvalidDrop, onHoverChange]);
}
