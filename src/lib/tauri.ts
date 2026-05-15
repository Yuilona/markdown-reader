import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';

/**
 * Thin wrappers around Tauri APIs used in PR-1.
 *
 * Window controls back the custom titlebar (Win11 frameless mode).
 * `getDataDir` reads the portable data path from the Rust side.
 * `openFileDialog` only logs the selection in PR-1; PR-5 wires the real load.
 */

export const minimize = (): Promise<void> => getCurrentWindow().minimize();

export const toggleMaximize = (): Promise<void> => getCurrentWindow().toggleMaximize();

export const closeWindow = (): Promise<void> => getCurrentWindow().close();

export const getDataDir = (): Promise<string> => invoke<string>('get_data_dir');

export async function openFileDialog(): Promise<string | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  if (typeof path === 'string') {
    // PR-1: just log the selection. PR-5 will wire actual file open.
    // eslint-disable-next-line no-console
    console.log('[markdown-reader] selected file:', path);
    return path;
  }
  return null;
}
