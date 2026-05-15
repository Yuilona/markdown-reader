import { useEffect } from 'react';
import { openFileDialog, type LoadedDocument } from '../lib/tauri';

interface UseShortcutsOptions {
  /** Invoked when Ctrl+O picks a file. Optional so PR-1-era callers
   *  (which only wanted the dialog to open) keep working. */
  onOpenDocument?: (doc: LoadedDocument) => void;
}

/**
 * Global keyboard shortcuts hook.
 *
 * PR-2: Ctrl+O opens the dialog AND, if the caller passes
 * `onOpenDocument`, hands the loaded document back so App.tsx can
 * promote it to state. The callback is captured via a ref-equivalent
 * (re-binding the listener whenever it changes) so closures stay fresh
 * without the tear-down dance.
 *
 * Additional shortcuts (R13 in PRD) land in later PRs.
 */
export function useShortcuts(options: UseShortcutsOptions = {}): void {
  const { onOpenDocument } = options;

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // Ctrl+O on Windows; on macOS Cmd+O would use metaKey, but v0.1 is
      // Windows-only.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        const doc = await openFileDialog();
        if (doc && onOpenDocument) onOpenDocument(doc);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpenDocument]);
}
