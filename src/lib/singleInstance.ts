import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { isMarkdownPath } from './pathUtils';

/**
 * Wiring for the two ways an external file path can arrive at the app:
 *
 *   1. `second-instance` event — emitted by `tauri-plugin-single-instance`
 *      when a second copy of the .exe is launched (e.g., the user
 *      double-clicks another .md while the app is already open).
 *
 *   2. `take_cli_launch_path` command — drains the path that was passed
 *      as argv[1] to the FIRST launch (e.g., file association launched us).
 *      The take-once semantics live in the Rust state so React StrictMode
 *      double-mount doesn't open the file twice.
 */
export interface SecondInstanceCallbacks {
  /** Called with a validated absolute path. Caller loads it. */
  onValidPath: (path: string) => void;
  /** Called when argv exists but is not a .md / .markdown file. */
  onInvalidPath?: () => void;
}

export async function registerSecondInstanceListener(
  callbacks: SecondInstanceCallbacks,
): Promise<UnlistenFn | null> {
  try {
    const unlisten = await listen<string[]>('second-instance', (event) => {
      const args = event.payload;
      // eslint-disable-next-line no-console
      console.log('[markdown-reader] second-instance argv:', args);
      // argv[0] is the exe path. The first real argument is at index 1.
      const candidate = args?.[1];
      if (!candidate) return; // nothing to do — silent
      if (isMarkdownPath(candidate)) {
        callbacks.onValidPath(candidate);
      } else {
        callbacks.onInvalidPath?.();
      }
    });
    return unlisten;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to register second-instance listener:', err);
    return null;
  }
}

/**
 * Drain the CLI-launch path the Rust side captured at startup. Returns
 * `null` if no markdown path was passed (the common case for a launcher
 * that opens the app with no file). The Rust state is consumed by this
 * call — subsequent calls return `null` even if a path was passed.
 *
 * Rust already validated existence + extension; the additional
 * `isMarkdownPath` guard here is paranoia, not duplication.
 */
export async function takeCliLaunchPath(): Promise<string | null> {
  try {
    const path = await invoke<string | null>('take_cli_launch_path');
    if (!path) return null;
    return isMarkdownPath(path) ? path : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to fetch cli launch path:', err);
    return null;
  }
}
