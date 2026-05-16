/**
 * Small path helpers used by recent-files, drag-drop, and EmptyState.
 *
 * v0.1 is Windows-only. We deliberately normalize to backslash form
 * (the OS-native shape) and compare case-insensitively (Windows file
 * paths are case-insensitive). When v0.2 ships cross-platform builds
 * these helpers will need a `process.platform` switch — flag for later.
 */

/** Normalize to backslash form (Windows native). */
export function normalizePath(p: string): string {
  return p.replace(/\//g, '\\');
}

/** Case-insensitive path equality (Windows semantics). */
export function pathsEqual(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

/** Final path segment ("foo.md" from any of the slash styles). */
export function basename(p: string): string {
  // Split on both separators so paths like "C:/foo\bar.md" still work.
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/** Directory portion ("C:\foo" from "C:\foo\bar.md"). */
export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx >= 0 ? p.slice(0, idx) : '';
}

/** Lowercased extension WITHOUT the leading dot. */
export function extname(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** True if the path ends in `.md` or `.markdown` (case-insensitive). */
export function isMarkdownPath(p: string): boolean {
  const ext = extname(p);
  return ext === 'md' || ext === 'markdown';
}
