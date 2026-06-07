/**
 * Small path helpers used by recent-files, drag-drop, EmptyState, link
 * routing, and the data-dir persistence layer.
 *
 * Cross-platform (Windows / macOS / Linux). Separator handling is
 * platform-aware: the platform is detected once from the webview
 * userAgent (synchronous, no plugin / no IPC) so these helpers stay sync
 * and usable at import time. `joinUnder` is the exception — it infers the
 * separator from its `dir` argument, which keeps Windows-fixture tests
 * stable and never depends on the global platform flags.
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
/** True on Windows builds (backslash-native, case-insensitive FS). */
export const IS_WINDOWS = ua.includes('Windows');
/** True on macOS builds (forward-slash native, case-insensitive FS by default). */
export const IS_MAC = /Macintosh|Mac OS X/.test(ua);

/**
 * Normalize separators to the OS-native form.
 *   - Windows: forward slashes → backslashes. Dialogs / drag-drop
 *     occasionally hand back mixed separators; backslash is the native shape.
 *   - macOS / Linux: identity. posix paths already use '/', and '\' is a
 *     legal filename character there — rewriting it would corrupt paths.
 */
export function normalizePath(p: string): string {
  return IS_WINDOWS ? p.replace(/\//g, '\\') : p;
}

/**
 * Path equality. Case-insensitive on Windows and macOS (both default to
 * case-insensitive filesystems); case-sensitive on Linux. Compares after
 * separator normalization so '/' vs '\' inputs still match on Windows.
 */
export function pathsEqual(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return IS_WINDOWS || IS_MAC ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/**
 * Join `name` onto a directory path, using the directory's OWN separator.
 * The separator is inferred from `dir` (Windows absolute paths always
 * contain '\' via the drive/UNC prefix; posix absolute paths only contain
 * '/') rather than the global platform flag. That keeps the helper correct
 * even for a Windows-shaped fixture dir on a non-Windows test host, and
 * skips the IPC round-trip of `@tauri-apps/api/path.join`. Used for paths
 * built on top of the Rust `get_data_dir` result and for relative-link
 * resolution.
 */
export function joinUnder(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir}${sep}${name}`;
}

/** Final path segment ("foo.md" from any of the slash styles). */
export function basename(p: string): string {
  // Split on both separators so paths like "C:/foo\bar.md" still work.
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/** Directory portion ("C:\foo" from "C:\foo\bar.md", "/a/b" from "/a/b/c.md"). */
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
