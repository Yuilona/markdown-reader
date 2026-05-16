import { useEffect } from 'react';
import { openFileDialog, type LoadedDocument } from '../lib/tauri';
import { useTheme } from '../components/ThemeProvider/useTheme';
import type { ThemeMode } from '../lib/settings';

interface UseShortcutsOptions {
  /** Invoked when Ctrl+O picks a file. Optional so PR-1-era callers
   *  (which only wanted the dialog to open) keep working. */
  onOpenDocument?: (doc: LoadedDocument) => void;
}

/**
 * Cycle order for Ctrl+T (R13). Mirrors the Titlebar button cycle.
 *   light → dark → system → light → ...
 */
const THEME_CYCLE: ThemeMode[] = ['light', 'dark', 'system'];

function nextMode(current: ThemeMode): ThemeMode {
  const idx = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}

/**
 * Global keyboard shortcuts hook.
 *
 *   - `Ctrl+O` opens the native file dialog (R13).
 *   - `Ctrl+T` cycles the theme (R13, PR-6).
 *
 * Additional shortcuts (R13: Ctrl+W close, Ctrl+P print, search, etc.)
 * land in later PRs.
 *
 * PR-5a: `openFileDialog` now funnels through `loadDocument`, so the
 * recent-list is updated automatically.
 *
 * PR-6: this hook MUST be called from inside a `<ThemeProvider>` so the
 * Ctrl+T handler can read+set the current mode. App.tsx places it
 * inside the provider tree.
 */
export function useShortcuts(options: UseShortcutsOptions = {}): void {
  const { onOpenDocument } = options;
  const { mode, setMode } = useTheme();

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // Ctrl+O on Windows; on macOS Cmd+O would use metaKey, but v0.1 is
      // Windows-only.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        const doc = await openFileDialog();
        if (doc && onOpenDocument) onOpenDocument(doc);
        return;
      }
      // Ctrl+T cycles theme (R13).
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setMode(nextMode(mode));
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpenDocument, mode, setMode]);
}
