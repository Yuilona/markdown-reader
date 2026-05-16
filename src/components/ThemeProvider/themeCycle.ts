import type { ThemeMode } from '../../lib/settings';

/**
 * Theme cycle order used by BOTH the Titlebar's theme-toggle button and
 * the `Ctrl+T` keyboard shortcut (R13). Extracted in PR-7 so the array
 * + the `nextMode` helper live in a single place — previously they were
 * duplicated in Titlebar.tsx and useShortcuts.ts and would silently
 * drift if either copy got reordered (e.g. dropping 'system' from the
 * cycle).
 *
 *   light → dark → system → light → ...
 */
export const THEME_CYCLE: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** Return the next theme mode in the cycle, wrapping around. */
export function nextMode(current: ThemeMode): ThemeMode {
  const idx = THEME_CYCLE.indexOf(current);
  // -1 (unknown current value) wraps to index 0 = 'light'. Defensive
  // against any future hand-edited settings.json with an off-schema
  // theme name; we just snap back to the canonical first entry.
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}
