import { useState, type CSSProperties } from 'react';

import { basename } from '../../lib/pathUtils';
import styles from './ImageWithFallback.module.css';

interface ImageWithFallbackProps {
  /** The fully-resolved src URL (asset:// for local, https:// for remote,
   *  or undefined for malformed markdown). */
  resolvedSrc: string | undefined;
  /** Alt text — also used as the native `title` tooltip (R6.6) AND as
   *  the fallback label when the load fails. */
  alt: string;
  /** The original href the markdown author wrote — shown in the failure
   *  placeholder so the user knows WHICH image broke. */
  originalSrc: string | undefined;
  /** Click handler — installed by DocumentView to open the lightbox.
   *  Skipped when there's no resolvedSrc OR when the image has failed
   *  to load (clicking a broken placeholder would lightbox an empty URL). */
  onClick?: () => void;
  /** PR-8: right-click handler — installed by DocumentView to show the
   *  R6.7 image context menu (Copy image / Save as / Open in system).
   *  Attached to BOTH the rendered <img> and the failure placeholder
   *  span so the user can still pick "Save as" on a placeholder that
   *  shows a broken HTTP URL. */
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Image renderer with R6.5 failure fallback + R6.4 lazy-load + R6.6
 * tooltip + PR-4 click-to-lightbox.
 *
 * Rendering:
 *   - When `resolvedSrc` is undefined (malformed markdown): render the
 *     placeholder immediately with the original src text.
 *   - When the browser fires `onError` on the img: switch to the
 *     placeholder.
 *   - Otherwise: render the img with `loading="lazy"` and the title
 *     mirror of alt.
 *
 * Why a wrapper component (rather than inline onError on the img):
 *   - We need React state to swap the rendered DOM cleanly. Mutating
 *     the img directly in onError (display:none + insert sibling) works
 *     but fights React's reconciler — the next render would undo our
 *     mutation. A small wrapper with `useState` is idiomatic and clean.
 */
export function ImageWithFallback({
  resolvedSrc,
  alt,
  originalSrc,
  onClick,
  onContextMenu,
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  // R6.5 placeholder: shown when src is missing OR load failed.
  if (!resolvedSrc || failed) {
    const label = originalSrc ? basename(originalSrc) || originalSrc : alt;
    return (
      <span
        className={styles.placeholder}
        title={originalSrc ?? ''}
        onContextMenu={onContextMenu}
      >
        <span className={styles.placeholderIcon} aria-hidden="true">
          {/* "broken image" glyph — keeps the affordance even when alt
              is empty. Inline SVG for crisp scaling. */}
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M21 5v6.59l-3-3.01l-4 4.01L10 8.59l-4 4V5h15m0-2H6c-1.1 0-2 .9-2 2v14a2 2 0 0 0 2 2h15c1.1 0 2-.9 2-2V5a2 2 0 0 0-2-2zM5 19l4-4l3 3l4-4l3 3l1 1H5z"
            />
          </svg>
        </span>
        <span className={styles.placeholderLabel}>
          {label || '图片加载失败'}
        </span>
      </span>
    );
  }

  const imgStyle: CSSProperties = onClick ? { cursor: 'zoom-in' } : {};

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      title={alt}
      loading="lazy"
      style={imgStyle}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onError={() => setFailed(true)}
    />
  );
}
