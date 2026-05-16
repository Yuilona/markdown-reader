import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ContextMenuItem } from './ContextMenuContext';
import styles from './ContextMenu.module.css';

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * The context menu UI. Portal-rendered to `document.body` so the menu
 * sits at the top of the stacking context regardless of how deeply
 * `<ContextMenuProvider>` is mounted.
 *
 * Dismissal:
 *   - Click outside        → close.
 *   - Esc                  → close.
 *   - Right-click outside  → close (the parent's onContextMenu can then
 *                            re-open with new items at the new spot).
 *   - Click on an item     → invoke onClick then close.
 *   - Scroll               → close (matches OS-native menu behavior).
 *
 * Positioning:
 *   - Initial position: (x, y) — the raw clientX/Y from the contextmenu
 *     event.
 *   - After mount we measure the menu rect and clamp into the viewport
 *     so the menu stays fully visible near a window corner.
 *
 * Z-index:
 *   9500 — above the status bar (2000) and toast stack (also 2000) and
 *   well above the TOC (1000) / search bar (1100). Below the lightbox
 *   (9999) — the PRD brief specifically says context menus should not
 *   appear over a lightbox (the user has already engaged a modal).
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Coordinates we render at — start with the raw click point, then
  // clamp to the viewport once the menu has measurable size.
  const [pos, setPos] = useState<{ x: number; y: number }>({ x, y });

  // Reset position whenever the requested point changes (e.g. the user
  // right-clicks elsewhere; the provider replaces this menu by re-
  // mounting via the same component — but defensively also reset on
  // prop change).
  useLayoutEffect(() => {
    setPos({ x, y });
  }, [x, y]);

  // After paint, clamp to the viewport. Reading getBoundingClientRect
  // in useLayoutEffect makes the adjustment happen BEFORE the user sees
  // the menu, so there's no flash at the off-screen position.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nextX = pos.x;
    let nextY = pos.y;
    // Right overflow: shift left by the overflow amount, leaving a 4px
    // gap from the viewport edge.
    if (nextX + rect.width + 4 > vw) {
      nextX = Math.max(4, vw - rect.width - 4);
    }
    // Bottom overflow: shift up.
    if (nextY + rect.height + 4 > vh) {
      nextY = Math.max(4, vh - rect.height - 4);
    }
    if (nextX !== pos.x || nextY !== pos.y) {
      setPos({ x: nextX, y: nextY });
    }
    // We deliberately only re-run when the menu is first rendered. The
    // pos comparison short-circuits a second render if no change is
    // needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global dismissal listeners.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    const onDocContextMenu = (e: MouseEvent) => {
      // Allow a right-click outside the menu to dismiss it. The new
      // right-click will then bubble through React and re-open via the
      // provider if the target has its own onContextMenu handler.
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onScroll = () => {
      onClose();
    };
    // `mousedown` (not click) so the menu disappears as soon as the
    // user starts a press elsewhere — feels snappier than waiting for
    // mouseup.
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('contextmenu', onDocContextMenu);
    window.addEventListener('keydown', onKey);
    // Capture so we catch scroll on the scroll container as well as on
    // window (the document scroll area uses overflow:auto on a div, not
    // on window — so window scroll alone wouldn't fire there).
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('contextmenu', onDocContextMenu);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  const handleItemClick = async (item: ContextMenuItem) => {
    if (item.separator || item.disabled) return;
    // Close FIRST so the menu doesn't linger during an async onClick
    // (e.g. clipboard write that involves a couple of awaits). The
    // user has visually committed to the action by clicking the item.
    onClose();
    if (item.onClick) {
      try {
        await item.onClick();
      } catch {
        // onClick handlers are expected to handle their own errors
        // (and surface them as toasts). We don't want a stray throw
        // to leave the app in a bad state.
      }
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => {
        // Suppress the browser's default contextmenu on the menu
        // itself — a right-click on a menu item should not open
        // another menu on top of this one.
        e.preventDefault();
      }}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className={styles.separator} role="separator" />;
        }
        const className = item.disabled
          ? `${styles.item} ${styles.itemDisabled}`
          : styles.item;
        return (
          <button
            key={idx}
            type="button"
            className={className}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => void handleItemClick(item)}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
