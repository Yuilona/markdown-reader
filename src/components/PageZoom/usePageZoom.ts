import { useContext } from 'react';

import { PageZoomContext, type PageZoomContextValue } from './PageZoomProvider';

/**
 * Subscribe to the page-zoom context (PR-9, R10.5, R13).
 *
 * Throws (rather than returning a silent no-op) if called outside a
 * `<PageZoomProvider>` — mirrors `useTheme` and `useLightbox`. App.tsx
 * mounts the provider at the root so every consumer (currently just
 * `useShortcuts` for Ctrl+= / Ctrl+- / Ctrl+0) is inside the tree.
 */
export function usePageZoom(): PageZoomContextValue {
  const value = useContext(PageZoomContext);
  if (!value) {
    throw new Error('usePageZoom() must be used within <PageZoomProvider>.');
  }
  return value;
}
