import type { MouseEvent as ReactMouseEvent } from 'react';
import styles from './Mermaid.module.css';

interface MermaidToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFullscreen: () => void;
}

/**
 * Floating toolbar shown in the top-right of a Mermaid diagram on hover
 * (R4.2, "Floating toolbar"). Four icon-only buttons: zoom-out, zoom-in,
 * reset, fullscreen.
 *
 * Visibility is driven by a CSS rule on the parent `.container:hover`
 * pseudo-class — we don't manage hover state in JS so the toolbar can
 * appear/disappear without React re-renders.
 *
 * Each button STOPS pointer propagation so a click on a button doesn't
 * also start a pan inside the SVG sitting underneath it.
 */
export function MermaidToolbar({
  onZoomIn,
  onZoomOut,
  onReset,
  onFullscreen,
}: MermaidToolbarProps) {
  // Adapter: the buttons receive a React mouse event; the toolbar's
  // contract takes a void callback. Wrapping here keeps the call sites
  // tidy and lets us stopPropagation in one place.
  const handle = (cb: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    cb();
  };

  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label="Mermaid diagram controls"
      // PR-8: hide during print (R11.3) — the toolbar is hover-only UX
      // and would otherwise paint on top of the printed SVG.
      data-print-hide
    >
      <button
        type="button"
        className={styles.toolbarBtn}
        onClick={handle(onZoomOut)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="缩小"
        title="缩小"
      >
        {/* Minus icon */}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path fill="currentColor" d="M2 7.5h12v1H2z" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        onClick={handle(onZoomIn)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="放大"
        title="放大"
      >
        {/* Plus icon */}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path fill="currentColor" d="M7.5 2h1v5.5H14v1H8.5V14h-1V8.5H2v-1h5.5z" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        onClick={handle(onReset)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="重置缩放"
        title="重置"
      >
        {/* Circular-arrow / refresh icon */}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 3a5 5 0 0 1 4.546 2.914l-1.353.451A3.5 3.5 0 1 0 11.5 8h1.5A5 5 0 1 1 8 3z"
          />
          <path fill="currentColor" d="M14 2v4h-4z" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.toolbarBtn}
        onClick={handle(onFullscreen)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="全屏查看"
        title="全屏"
      >
        {/* Expand-corners icon */}
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M2 2h5v1.5H3.5V7H2zm12 0v5h-1.5V3.5H9V2zM2 14V9h1.5v3.5H7V14zm12 0H9v-1.5h3.5V9H14z"
          />
        </svg>
      </button>
    </div>
  );
}
