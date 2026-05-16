import { useContext } from 'react';

import { ThemeContext, type ThemeContextValue } from './ThemeProvider';

/**
 * Subscribe to the theme context.
 *
 * Throws (rather than returning a silent no-op) if called outside a
 * `<ThemeProvider>` — that mirrors `useLightbox`'s contract and surfaces
 * misuse during development. In practice App.tsx mounts the provider
 * at the root so every component is inside.
 *
 * Consumers should treat `effective` ('light' | 'dark') as the source
 * of truth for "what palette is on screen right now". `mode` is the
 * user-facing tri-state ('light' | 'dark' | 'system') exposed only by
 * the theme toggle UI in Titlebar + the Ctrl+T shortcut.
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme() must be used within <ThemeProvider>.');
  }
  return value;
}
