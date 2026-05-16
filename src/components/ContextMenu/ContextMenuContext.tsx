import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ContextMenu } from './ContextMenu';

/**
 * Right-click context menu system (R6.7, R7.7, R14.5, PR-8).
 *
 * One menu, one provider, mounted at the App root. Consumers (link
 * overrides, image overrides, Mermaid container) call `open(x, y, items)`
 * from their own `onContextMenu` handler. The menu UI is portal-rendered
 * to `document.body`, so its z-index controls stacking regardless of
 * tree position.
 *
 * Item contract:
 *   - `label`: visible text. Required.
 *   - `onClick`: called when the user picks the item. The provider
 *     auto-closes the menu after `onClick` returns (even if it's async).
 *   - `separator: true`: render a horizontal divider in the menu; the
 *     item's `label` and `onClick` are ignored for separator entries.
 *
 * Coordinate system: `x` / `y` are CLIENT coordinates (matches
 * `MouseEvent.clientX/Y`). The menu auto-clamps if it would overflow
 * the viewport — see `ContextMenu.tsx`.
 *
 * Single-menu model:
 *   Opening a new menu while one is already open replaces it. There is
 *   never more than one context menu visible.
 */

export interface ContextMenuItem {
  label?: string;
  onClick?: () => void | Promise<void>;
  /** When true, render as a separator (label/onClick ignored). */
  separator?: boolean;
  /** When true, render as disabled (greyed-out, not clickable). */
  disabled?: boolean;
}

interface OpenMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuContextValue {
  open: (x: number, y: number, items: ContextMenuItem[]) => void;
  close: () => void;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);
export { ContextMenuContext };

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenMenuState | null>(null);

  const open = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
    // Empty items array → nothing to show, treat as no-op so callers
    // don't have to guard. Also guards against menus where every item
    // was filtered out by some upstream condition (e.g. an image
    // contextmenu whose "Open in system viewer" only makes sense for
    // local images).
    if (items.length === 0) {
      setState(null);
      return;
    }
    setState({ x, y, items });
  }, []);

  const close = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo<ContextMenuContextValue>(
    () => ({ open, close }),
    [open, close],
  );

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      {state && (
        <ContextMenu
          x={state.x}
          y={state.y}
          items={state.items}
          onClose={close}
        />
      )}
    </ContextMenuContext.Provider>
  );
}

/**
 * Hook for opening / closing the context menu. Returns a no-op fallback
 * when not inside a provider so a deep component that gates its own
 * usage doesn't crash. App.tsx always mounts the provider in practice.
 */
export function useContextMenu(): ContextMenuContextValue {
  const value = useContext(ContextMenuContext);
  if (!value) {
    return NOOP;
  }
  return value;
}

const NOOP: ContextMenuContextValue = {
  open: () => undefined,
  close: () => undefined,
};
