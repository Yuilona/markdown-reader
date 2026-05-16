import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';

import { normalizePath, isMarkdownPath } from './pathUtils';
import { pushRecent } from './recentFiles';

/**
 * Thin wrappers around Tauri APIs.
 *
 * Window controls back the custom titlebar (Win11 frameless mode).
 * `getDataDir` reads the portable data path from the Rust side.
 *
 * PR-5a: all five file-open paths (dialog / drag-drop / recent click /
 * second-instance / CLI) funnel through `loadDocument(path)` so that
 * recent-list bookkeeping and error handling stay in one place. The
 * previous `openFileDialog()` is retained as a thin wrapper.
 */

export const minimize = (): Promise<void> => getCurrentWindow().minimize();

export const toggleMaximize = (): Promise<void> => getCurrentWindow().toggleMaximize();

export const closeWindow = (): Promise<void> => getCurrentWindow().close();

export const getDataDir = (): Promise<string> => invoke<string>('get_data_dir');

/** A loaded markdown document: absolute path on disk + raw text. */
export interface LoadedDocument {
  path: string;
  text: string;
}

/**
 * Read a markdown file from disk and (on success) update the recent list.
 * Returns `null` on read failure — a proper toast UI lands in PR-8 (R12.5);
 * for now callers can show a minimal banner.
 *
 * Path is normalized to backslash form so both the in-app `LoadedDocument`
 * and the persisted recent.json share one representation.
 */
export async function loadDocument(path: string): Promise<LoadedDocument | null> {
  if (!isMarkdownPath(path)) {
    return null;
  }
  const normalized = normalizePath(path);
  try {
    const text = await readTextFile(normalized);
    // Fire-and-forget the recent-list update. A persistence failure must
    // never block the document open.
    void pushRecent(normalized);
    return { path: normalized, text };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to read file:', normalized, err);
    return null;
  }
}

/**
 * Show the native open dialog filtered to markdown files, then load the
 * picked file via `loadDocument`. Returns `null` if the user cancelled or
 * the read failed.
 */
export async function openFileDialog(): Promise<LoadedDocument | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (typeof picked !== 'string') {
    return null;
  }
  return loadDocument(picked);
}
