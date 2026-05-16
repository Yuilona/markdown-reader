import { useEffect } from 'react';
import { openFileDialog, type LoadedDocument } from '../lib/tauri';
import { useTheme } from '../components/ThemeProvider/useTheme';
import { nextMode } from '../components/ThemeProvider/themeCycle';

interface UseShortcutsOptions {
  /** Invoked when Ctrl+O picks a file. Optional so PR-1-era callers
   *  (which only wanted the dialog to open) keep working. */
  onOpenDocument?: (doc: LoadedDocument) => void;
  /** PR-7: Ctrl+F handler. Opens the SearchBar — wired from App.tsx
   *  via a state setter. When the bar is already open, the same
   *  shortcut still fires and the consumer is responsible for
   *  re-focusing + selecting the input. */
  onOpenSearch?: () => void;
  /** PR-7: Ctrl+\ handler. Toggles the TOC sidebar's visibility. */
  onToggleToc?: () => void;
}

/**
 * Global keyboard shortcuts hook.
 *
 *   - `Ctrl+O` opens the native file dialog (R13).
 *   - `Ctrl+T` cycles the theme (R13, PR-6).
 *   - `Ctrl+F` opens the search bar (R13, PR-7).
 *   - `Ctrl+\` toggles the TOC sidebar (R13, PR-7).
 *   - `Ctrl+P` opens the system print dialog (R13, R11.1, PR-8).
 *
 * Additional shortcuts (R13: Ctrl+W close, etc.) land in later PRs /
 * follow-ups.
 *
 * PR-5a: `openFileDialog` now funnels through `loadDocument`, so the
 * recent-list is updated automatically.
 *
 * PR-6: this hook MUST be called from inside a `<ThemeProvider>` so the
 * Ctrl+T handler can read+set the current mode. App.tsx places it
 * inside the provider tree.
 *
 * PR-7: the `nextMode` helper + cycle constant are imported from
 * `themeCycle.ts` (extracted in PR-7 — same source the Titlebar uses).
 *
 * PR-8: Ctrl+P calls `window.print()` which opens the system print
 * dialog. On Windows that dialog includes "Save as PDF" as a built-in
 * option so we don't need a custom export-PDF command (R11.1).
 */
export function useShortcuts(options: UseShortcutsOptions = {}): void {
  const { onOpenDocument, onOpenSearch, onToggleToc } = options;
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
      // Ctrl+F opens the search bar (R13, PR-7). We use `key === 'f'`
      // so Shift+Ctrl+F (a hypothetical future "find all docs" shortcut)
      // doesn't accidentally trip the same path — the modifier-strict
      // gate above already requires no Shift.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (onOpenSearch) onOpenSearch();
        return;
      }
      // Ctrl+\ toggles TOC (R13, PR-7). The key string for backslash is
      // literally '\' on every keyboard layout that has one — Windows
      // delivers it as such regardless of locale.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        if (onToggleToc) onToggleToc();
        return;
      }
      // Ctrl+P opens the system print dialog (R13, R11.1, PR-8). We
      // preventDefault so the browser's built-in print path doesn't
      // double-fire (it would call the same window.print() anyway, but
      // suppressing keeps the contract single-source-of-truth in the
      // app).
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.print();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpenDocument, onOpenSearch, onToggleToc, mode, setMode]);
}
