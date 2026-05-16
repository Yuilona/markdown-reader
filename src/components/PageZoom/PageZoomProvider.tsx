import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { DEFAULT_SETTINGS } from '../../lib/settings';
import { getSettings, updateSettings } from '../../lib/settingsStore';

/**
 * Page-level zoom (R10.5, R13) — PR-9.
 *
 * Range: 50..200 percent, step 10. Applied via `document.body.style.zoom`
 * which Chromium / WebView2 supports natively — it scales the entire body
 * subtree proportionally (font sizes, images, layout). We apply on `body`
 * (not on `<html>`) because applying to the root scales the scrollbars
 * too, which looks odd.
 *
 * Persistence: the chosen value is written through to settings.json on
 * every change via the shared `settingsStore` (PR-9 hotfix). The store
 * serializes writes so a concurrent ThemeProvider / App.tsx update can't
 * clobber our pageZoom (and vice versa).
 *
 * Initial paint behaviour: we default to 100 (DEFAULT_SETTINGS.pageZoom)
 * before the async settings load completes. Once getSettings resolves
 * from the shared store, we promote to the persisted value. If the user
 * has a persisted non-100 zoom, they'll see a brief flicker on cold
 * start — same as the theme provider's brief flicker pattern.
 * Acceptable for v0.1.
 *
 * Why NOT `document.documentElement.style.zoom`: zooming the html
 * element causes the WebView2 scrollbar to render at the zoomed size,
 * which crowds the content edge at 150%+ zoom. body-level zoom keeps
 * the scrollbar at native size.
 *
 * Side-effect awareness: PR-7's IntersectionObserver-driven TOC uses
 * pixel rootMargin values; `body { zoom }` does NOT change the
 * IntersectionObserver root rect (it's a CSS scaling transform applied
 * at paint time, not a layout property). The TOC current-section
 * tracking continues to work at all zoom levels.
 */

const STEP = 10;
const MIN_ZOOM = 50;
const MAX_ZOOM = 200;

export interface PageZoomContextValue {
  /** Current zoom percent, e.g. 100, 110, 90. Always within [50, 200]. */
  zoom: number;
  /** Increase zoom by 10%; clamped at MAX_ZOOM (200). */
  zoomIn: () => void;
  /** Decrease zoom by 10%; clamped at MIN_ZOOM (50). */
  zoomOut: () => void;
  /** Reset to 100%. */
  resetZoom: () => void;
}

const PageZoomContext = createContext<PageZoomContextValue | null>(null);
export { PageZoomContext };

/** Snap to the nearest STEP multiple, then clamp into the valid range.
 *  Defensive: protects against any caller (or a corrupt settings file
 *  that slipped past readSettings' validate) handing us 73 or 9000. */
function snapAndClamp(value: number): number {
  const snapped = Math.round(value / STEP) * STEP;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, snapped));
}

/** Apply the zoom percent to the document body. Centralized so any
 *  future "force 100% during print" path (PR-8's @media print already
 *  hides chrome but doesn't change zoom — the print engine handles its
 *  own scaling) can compose with the same DOM toggle. */
function applyZoom(zoom: number): void {
  // The `zoom` CSS property is non-standard but supported by Chromium
  // and WebView2. Setting it as a string with a unit-less percent works
  // across versions. Setting it to `''` would reset to default (1.0).
  document.body.style.zoom = `${zoom}%`;
}

interface PageZoomProviderProps {
  children: ReactNode;
}

export function PageZoomProvider({ children }: PageZoomProviderProps) {
  // Default to 100 while settings.json is loading.
  const [zoom, setZoomState] = useState<number>(DEFAULT_SETTINGS.pageZoom);

  // Suppress the persistence write-back until the initial settings load
  // completes — otherwise the default mount would immediately re-write
  // settings.json with its own default value (harmless, but extra IO).
  const initializedRef = useRef(false);

  // ---- Mount: load persisted zoom via the shared settings store. ----
  // The store owns the cache; no per-provider snapshot ref needed.
  // Theme + showTocByDefault writes from peers stay safe because the
  // store merges partials atomically (PR-9 hotfix).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await getSettings();
      if (cancelled) return;
      const next = snapAndClamp(settings.pageZoom);
      setZoomState(next);
      // Flag set AFTER state updates so the [zoom] write-back effect
      // sees it as true on its next firing (which is triggered by the
      // setZoomState above if the value differs from DEFAULT_SETTINGS).
      initializedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Apply zoom to the DOM whenever `zoom` changes. ----
  useEffect(() => {
    applyZoom(zoom);
  }, [zoom]);

  // ---- Reset zoom on provider unmount. ----
  //
  // The provider is mounted at App root for the full app lifetime, so
  // under normal operation this cleanup never runs. The reason it exists
  // is hot-reload during development (Vite Fast Refresh remounts the
  // tree and a stale `zoom: 130%` would persist on body otherwise) and
  // defensive parity with the other "DOM-side-effect" effects (theme
  // mode also resets data-theme on unmount).
  //
  // We use a SEPARATE empty-deps effect (rather than a return-cleanup on
  // the `[zoom]` effect) so the reset only fires on unmount, not on
  // every zoom change. Putting cleanup on the `[zoom]` effect would
  // cause a brief flicker to default zoom between every zoomIn/zoomOut
  // call.
  useEffect(() => {
    return () => {
      document.body.style.zoom = '';
    };
  }, []);

  // ---- Persist `zoom` via the shared settings store whenever it
  //      changes (after the initial load completes). ----
  // `updateSettings` merges into the live cache and serializes the
  // atomic write — peer providers' fields are preserved automatically.
  // Errors are logged inside the store; we discard the returned promise.
  useEffect(() => {
    if (!initializedRef.current) return;
    void updateSettings({ pageZoom: zoom });
  }, [zoom]);

  const zoomIn = useCallback(() => {
    setZoomState((prev) => snapAndClamp(prev + STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((prev) => snapAndClamp(prev - STEP));
  }, []);

  const resetZoom = useCallback(() => {
    setZoomState(100);
  }, []);

  const value = useMemo<PageZoomContextValue>(
    () => ({ zoom, zoomIn, zoomOut, resetZoom }),
    [zoom, zoomIn, zoomOut, resetZoom],
  );

  return <PageZoomContext.Provider value={value}>{children}</PageZoomContext.Provider>;
}
