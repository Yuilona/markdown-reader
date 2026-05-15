import { useEffect } from 'react';
import { openFileDialog } from '../lib/tauri';

/**
 * Global keyboard shortcuts hook.
 *
 * PR-1 only registers `Ctrl+O` (open file dialog).
 * Additional shortcuts (R13 in PRD) are wired in later PRs.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+O on Windows; on macOS Cmd+O would use metaKey, but v0.1 is
      // Windows-only.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFileDialog();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
