import { useEffect } from 'react';
import {
  openFileDialog,
  quitApp,
  toggleFullscreen,
  type LoadedDocument,
} from '../lib/tauri';
import { useTheme } from '../components/ThemeProvider/useTheme';
import { nextMode } from '../components/ThemeProvider/themeCycle';
import { usePageZoom } from '../components/PageZoom/usePageZoom';
import * as logger from '../lib/logger';

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
  /** PR-9: Ctrl+W handler. Closes the current document and returns to
   *  the empty state (R13). No-op when nothing is open — App.tsx is
   *  responsible for that detail; this hook just dispatches. */
  onCloseDocument?: () => void;
  /** PR-9: Ctrl+R / F5 handler. Reloads the current document via the
   *  same `loadDocument(path, { skipRecent: true })` path that the
   *  file-watcher uses (R13, R2.6). No-op when nothing is open. */
  onReloadDocument?: () => void;
}

/**
 * Global keyboard shortcuts hook.
 *
 *   - `Ctrl+O` opens the native file dialog (R13).
 *   - `Ctrl+T` cycles the theme (R13, PR-6).
 *   - `Ctrl+F` opens the search bar (R13, PR-7).
 *   - `Ctrl+\` toggles the TOC sidebar (R13, PR-7).
 *   - `Ctrl+P` opens the system print dialog (R13, R11.1, PR-8).
 *   - `Ctrl+W` closes the current file (R13, PR-9).
 *   - `Ctrl+Q` quits the app (R13, PR-9).
 *   - `Ctrl+R` / `F5` reloads the current file (R13, PR-9).
 *   - `Ctrl+=` / `Ctrl++` page-zoom +10% (R13, R10.5, PR-9).
 *   - `Ctrl+-` page-zoom -10% (R13, R10.5, PR-9).
 *   - `Ctrl+0` page-zoom reset 100% (R13, R10.5, PR-9).
 *   - `F11` toggles window fullscreen (R13, PR-9).
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
 *
 * PR-9: this hook MUST also be inside a `<PageZoomProvider>` so the
 * Ctrl+= / Ctrl+- / Ctrl+0 handlers can call the zoom mutators. The
 * provider tree in App.tsx wraps ThemeProvider → PageZoomProvider →
 * ... → the consumer of useShortcuts.
 *
 * Ctrl+= note: on Windows the unmodified `=` key produces `=`, and
 * Shift+`=` produces `+`. We accept both `event.key === '='` AND
 * `event.key === '+'` so users with either physical-key habit
 * trigger the same zoom-in path.
 *
 * Input-focus gating: shortcuts apply globally and do NOT check whether
 * a text input has focus. The only meaningful overlap is Ctrl+W in the
 * SearchBar input (browsers no-op it; we hijack it to close the file —
 * matches the user expectation of "quick close" since SearchBar's Esc
 * is also bound). Other shortcuts (Ctrl+0, Ctrl+R, F5, F11) are
 * unaffected by input focus on Windows.
 */
export function useShortcuts(options: UseShortcutsOptions = {}): void {
  const {
    onOpenDocument,
    onOpenSearch,
    onToggleToc,
    onCloseDocument,
    onReloadDocument,
  } = options;
  const { mode, setMode } = useTheme();
  const { zoomIn, zoomOut, resetZoom } = usePageZoom();

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
      // Ctrl+W closes the current file (R13, PR-9). App.tsx maps this to
      // `setDoc(null)` which drops the user back to EmptyState. We
      // still fire even when nothing is open — the App handler is
      // idempotent and `setDoc(null)` on an already-null state is a
      // React no-op.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (onCloseDocument) onCloseDocument();
        return;
      }
      // Ctrl+Q quits the app (R13, PR-9). Calls getCurrentWindow().close()
      // — the app is single-window so closing terminates the process.
      // Errors are caught + logged; we never let a failed quit attempt
      // bubble up as an unhandled rejection.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        try {
          await quitApp();
        } catch (err) {
          logger.warn('Ctrl+Q quitApp failed:', err);
        }
        return;
      }
      // Ctrl+R reloads the current file (R13, PR-9). Goes through the
      // same `loadDocument(path, { skipRecent: true })` path the
      // file-watcher uses — preserves scroll position and does NOT
      // bump the recent-list.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (onReloadDocument) onReloadDocument();
        return;
      }
      // F5 is the alternate reload shortcut (R13, PR-9). No modifiers —
      // a bare F5 keypress. Matches browser convention.
      if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'F5') {
        e.preventDefault();
        if (onReloadDocument) onReloadDocument();
        return;
      }
      // Ctrl+= (and Ctrl++) page-zoom in (R13, R10.5, PR-9). The `=`
      // key without Shift produces `=`; Shift+`=` produces `+`. We
      // accept both so neither physical keypress habit is broken.
      // We do NOT require !e.shiftKey here for the `+` branch —
      // pressing the `+` key always involves Shift on a US/CN layout.
      if (e.ctrlKey && !e.altKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
        return;
      }
      // Ctrl+- page-zoom out (R13, R10.5, PR-9).
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
      }
      // Ctrl+0 page-zoom reset (R13, R10.5, PR-9). The KeyboardEvent's
      // `key` for the digit row is the literal digit character.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '0') {
        e.preventDefault();
        resetZoom();
        return;
      }
      // F11 toggles window fullscreen (R13, PR-9). Bare F11 — no
      // modifiers. Errors are caught + logged; transient toggle failure
      // shouldn't pop a toast.
      if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key === 'F11') {
        e.preventDefault();
        try {
          await toggleFullscreen();
        } catch (err) {
          logger.warn('F11 toggleFullscreen failed:', err);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    onOpenDocument,
    onOpenSearch,
    onToggleToc,
    onCloseDocument,
    onReloadDocument,
    mode,
    setMode,
    zoomIn,
    zoomOut,
    resetZoom,
  ]);
}
