import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PanZoom } from 'panzoom';
import type { LightboxContent } from './LightboxContext';
import styles from './Lightbox.module.css';

interface LightboxProps {
  /** When non-null, the overlay is open and renders this content. */
  content: LightboxContent | null;
  /** Called when the user dismisses the lightbox (ESC, backdrop, close button). */
  onClose: () => void;
}

/**
 * Portal-rendered full-screen viewer (R5).
 *
 * Renders nothing when `content === null` — the provider keeps this
 * component mounted at all times so the open/close transition is purely
 * a state change rather than a mount/unmount cascade.
 *
 * Pan/zoom: uses `panzoom` (anvaka). The library defaults are tuned for
 * exactly this UX (plain wheel zoom, drag pan), so we keep most of them.
 * R5.4-specific overrides:
 *   - `zoomDoubleClickSpeed: 1` disables panzoom's built-in dblclick
 *     zoom step; we add our own listener that resets transform instead.
 *   - `smoothScroll: false` for a snappier feel — the lightbox is a
 *     deliberate, focused mode and the inertia animation feels sluggish.
 *
 * Lifecycle: panzoom is dynamically imported on the first open. The
 * instance is created/disposed for each new piece of content so that
 * pan/zoom state never carries over between two different diagrams or
 * images (R5.6: lightbox state is NOT persisted).
 *
 * Dismissal (R5.5):
 *   - ESC key — global listener active only while open.
 *   - Clicking the backdrop (the area outside the content wrapper).
 *   - Clicking the explicit close button (top-right).
 *   Clicks on the content itself MUST NOT close, so the content wrapper
 *   stops propagation of `click` AND `mousedown` — the latter matters
 *   because panzoom listens on mousedown to start a drag and the click
 *   event still fires on release (even after a tiny drag), which would
 *   otherwise bubble to the backdrop and dismiss.
 */
export function Lightbox({ content, onClose }: LightboxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panZoomRef = useRef<PanZoom | null>(null);
  // Custom listener cleanup for the dblclick reset we install ourselves.
  const dblCleanupRef = useRef<(() => void) | null>(null);

  // ESC key handler — global, only active while open. We attach to
  // window (not document) for consistency with the rest of the app's
  // keyboard handling pattern.
  useEffect(() => {
    if (!content) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [content, onClose]);

  // Attach panzoom whenever `content` becomes non-null or changes.
  // Each open creates a fresh instance (no persisted state — R5.6).
  useEffect(() => {
    if (!content) return;
    const container = containerRef.current;
    if (!container) return;

    // The wrapper carrying `.pz-target` is the element panzoom transforms.
    const target = container.querySelector<HTMLElement>('.pz-target');
    if (!target) return;

    let disposed = false;

    // Lazy import — keeps the library off the initial bundle. panzoom is
    // ~30 KB so the impact is small either way, but lazy-loading is
    // consistent with the Mermaid + svg-pan-zoom pattern in PR-3.
    void import('panzoom').then((mod) => {
      if (disposed) return;
      const createPanZoom = mod.default;
      const pz = createPanZoom(target, {
        // Disable panzoom's built-in dblclick zoom; we add our own reset
        // listener below so dblclick returns to the natural fit (R5.4)
        // rather than zooming in another step.
        zoomDoubleClickSpeed: 1,
        smoothScroll: false,
        // Generous range — fullscreen view encourages deep inspection.
        minZoom: 0.1,
        maxZoom: 20,
        // panzoom's default wheel zoom anchors on the cursor — exactly
        // what the user wants now that the target sits at owner (0,0)
        // (the math assumes that). The previous "fly toward bottom-
        // right" bug was the flex-centering offset breaking the anchor
        // math, fixed in the CSS rather than here.
      });
      panZoomRef.current = pz;

      // Center the target inside the owner on the next layout frame.
      // The wrapper's size is determined by the SVG (or img) inside,
      // which finishes layout in the frame after dangerouslySetInnerHTML
      // commits. Storing initialX/Y so the dblclick handler can reset to
      // the same centered state instead of (0,0).
      let initialX = 0;
      let initialY = 0;
      const rafId = window.requestAnimationFrame(() => {
        if (disposed) return;
        const ownerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        initialX = (ownerRect.width - targetRect.width) / 2;
        initialY = (ownerRect.height - targetRect.height) / 2;
        pz.moveTo(initialX, initialY);
      });

      // R5.4: dblclick → reset to centered + scale 1. Use the stored
      // initialX/Y so the reset returns the diagram to its initial
      // mounted position, not to owner (0,0) which would shove it to
      // the top-left corner.
      const dblHandler = (e: MouseEvent) => {
        e.preventDefault();
        pz.zoomAbs(initialX, initialY, 1);
        pz.moveTo(initialX, initialY);
      };
      target.addEventListener('dblclick', dblHandler);
      dblCleanupRef.current = () => {
        window.cancelAnimationFrame(rafId);
        target.removeEventListener('dblclick', dblHandler);
      };
    });

    return () => {
      disposed = true;
      dblCleanupRef.current?.();
      dblCleanupRef.current = null;
      const pz = panZoomRef.current;
      if (pz) {
        try {
          pz.dispose();
        } catch {
          // panzoom can throw if the target was already detached. We
          // only care that our listeners are gone — safe to ignore.
        }
        panZoomRef.current = null;
      }
    };
  }, [content]);

  if (!content) return null;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className={styles.closeBtn}
        onClick={(e) => {
          // Stop the click from also hitting the backdrop and triggering
          // a double-dismiss — single onClose() is enough.
          e.stopPropagation();
          onClose();
        }}
        aria-label="关闭 (ESC)"
        title="关闭 (ESC)"
      >
        {/* X icon — inline SVG for crisp rendering at any DPI. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"
          />
        </svg>
      </button>
      <div
        ref={containerRef}
        className={styles.contentArea}
        // The content wrapper swallows pointer events so they don't
        // bubble to the backdrop's onClick (which would close).
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {content.kind === 'svg' ? (
          <div
            className={`${styles.svgWrapper} pz-target`}
            // Inject the cached SVG string from Mermaid. This is the
            // "clone" path per the PRD tech note — a fresh DOM subtree
            // panzoom can manipulate without disturbing the inline
            // diagram's DOM.
            dangerouslySetInnerHTML={{ __html: content.svg }}
          />
        ) : (
          <img
            className={`${styles.image} pz-target`}
            src={content.src}
            alt={content.alt ?? ''}
            draggable={false}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
