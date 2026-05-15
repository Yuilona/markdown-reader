import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';

/**
 * Thin wrappers around Tauri APIs.
 *
 * Window controls back the custom titlebar (Win11 frameless mode).
 * `getDataDir` reads the portable data path from the Rust side.
 * `openFileDialog` opens the OS file picker, then reads the selected
 *   file as UTF-8 text (PR-2 minimal load pipeline). PR-5 will extend
 *   this with drag-drop, recent list, and watcher hookups.
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
 * Show the native open dialog filtered to markdown files. Returns the
 * loaded document (path + text) on success, or `null` if the user
 * cancelled. Caller is expected to surface read errors; PR-2 lets
 * exceptions propagate so the dev console shows them — a proper toast
 * UI lands in PR-8 (R12.5).
 */
export async function openFileDialog(): Promise<LoadedDocument | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (typeof path !== 'string') {
    return null;
  }
  const text = await readTextFile(path);
  return { path, text };
}
