import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Lightbox } from './Lightbox';

/**
 * Content that can be displayed in the lightbox.
 *
 * Two kinds:
 *   - `svg`: an SVG string (used by Mermaid's Fullscreen button). The
 *     string is injected via `dangerouslySetInnerHTML` so we get a fresh
 *     DOM subtree the lightbox can manipulate without touching the inline
 *     diagram's DOM. Per the PRD's tech note: "clone the SVG node (don't
 *     move it) so the inline diagram remains in place when the lightbox
 *     closes."
 *   - `image`: a URL + optional alt (used by clicking any rendered
 *     `<img>`). PR-4 operates on whatever `src` is currently set, even a
 *     broken/HTTPS URL — PR-5 will wire `convertFileSrc` for local paths,
 *     after which the lightbox image path just works since it operates on
 *     the already-rendered `src`.
 */
export type LightboxContent =
  | { kind: 'svg'; svg: string }
  | { kind: 'image'; src: string; alt?: string };

interface LightboxContextValue {
  /** Open the lightbox with the given content. Replaces any currently-open content. */
  open: (content: LightboxContent) => void;
  /** Close the lightbox. No-op if already closed. */
  close: () => void;
}

const LightboxContext = createContext<LightboxContextValue | null>(null);

/**
 * Hook for opening / closing the lightbox. MUST be called from within a
 * `<LightboxProvider>` subtree.
 *
 * Throws (rather than returning a silent no-op) so misuse surfaces during
 * development instead of producing a button that does nothing in
 * production.
 */
export function useLightbox(): LightboxContextValue {
  const value = useContext(LightboxContext);
  if (!value) {
    throw new Error('useLightbox() must be used within <LightboxProvider>.');
  }
  return value;
}

/**
 * Provides the lightbox open/close handle and mounts the portal-rendered
 * `<Lightbox>` once at the provider level. Because the actual overlay
 * lives in a `document.body` portal (see `Lightbox.tsx`), the provider's
 * DOM position in the tree doesn't affect z-index stacking — it only
 * affects which subtree can call `useLightbox()`.
 *
 * Mounting the Lightbox here (rather than inside the consumer) means the
 * portal is created exactly once for the app lifetime, and the React
 * subtree can dispatch open() from any depth.
 */
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<LightboxContent | null>(null);

  const open = useCallback((c: LightboxContent) => setContent(c), []);
  const close = useCallback(() => setContent(null), []);

  // Stable context value across renders that don't change open/close
  // identity — avoids forcing every consumer to re-render.
  const value = useMemo<LightboxContextValue>(() => ({ open, close }), [open, close]);

  return (
    <LightboxContext.Provider value={value}>
      {children}
      <Lightbox content={content} onClose={close} />
    </LightboxContext.Provider>
  );
}
