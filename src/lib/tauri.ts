import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { normalizePath, isMarkdownPath } from './pathUtils';
import { pushRecent } from './recentFiles';
import * as logger from './logger';

/**
 * Thin wrappers around Tauri APIs.
 *
 * Window controls back the custom titlebar (Win11 frameless mode).
 * `getDataDir` reads the portable data path from the Rust side.
 *
 * PR-5a: all five file-open paths (dialog / drag-drop / recent click /
 * second-instance / CLI) funnel through `loadDocument(path)` so that
 * recent-list bookkeeping and error handling stay in one place.
 *
 * PR-5b: `loadDocument(path, { skipRecent: true })` lets the file-watcher
 * reload path re-read the file WITHOUT bumping the recent list — saving
 * in an external editor should not be treated as a "user-initiated open"
 * for recent-list semantics.
 */

export const minimize = (): Promise<void> => getCurrentWindow().minimize();

export const toggleMaximize = (): Promise<void> => getCurrentWindow().toggleMaximize();

export const closeWindow = (): Promise<void> => getCurrentWindow().close();

/**
 * PR-9: Ctrl+Q quit alias. Same underlying call as `closeWindow` (the app
 * is a single window so closing it terminates the process). Named
 * separately so the call site reads naturally — `quitApp()` for a Ctrl+Q
 * handler, `closeWindow()` for the titlebar ✕ button.
 */
export const quitApp = (): Promise<void> => getCurrentWindow().close();

/**
 * PR-9: F11 fullscreen toggle (R13). Reads the current fullscreen state
 * and flips it. Errors are surfaced to the caller (useShortcuts logs +
 * swallows them) — a transient toggle failure is not worth interrupting
 * the user with a toast.
 */
export const toggleFullscreen = async (): Promise<void> => {
  const win = getCurrentWindow();
  const current = await win.isFullscreen();
  await win.setFullscreen(!current);
};

export const getDataDir = (): Promise<string> => invoke<string>('get_data_dir');

/** A loaded markdown document: absolute path on disk + raw text. */
export interface LoadedDocument {
  path: string;
  text: string;
}

/** Options for `loadDocument`. */
export interface LoadDocumentOptions {
  /**
   * If true, the recent.json LRU is NOT bumped. Used by the file-watcher
   * auto-reload path (R2.6) where the re-read is internal, not a fresh
   * "user opened this file" event.
   */
  skipRecent?: boolean;
}

/**
 * Read a markdown file from disk. On success and when `skipRecent` is
 * falsy, also updates the recent list. Returns `null` on read failure —
 * a proper toast UI lands in PR-8 (R12.5); for now callers can show a
 * minimal banner.
 *
 * Path is normalized to backslash form so both the in-app `LoadedDocument`
 * and the persisted recent.json share one representation.
 */
export async function loadDocument(
  path: string,
  options: LoadDocumentOptions = {},
): Promise<LoadedDocument | null> {
  if (!isMarkdownPath(path)) {
    return null;
  }
  const normalized = normalizePath(path);
  try {
    const text = await readTextFile(normalized);
    if (!options.skipRecent) {
      // Fire-and-forget the recent-list update. A persistence failure must
      // never block the document open.
      void pushRecent(normalized);
    }
    return { path: normalized, text };
  } catch (err) {
    // PR-8: console mirror + rolling log file. The toast for "file
    // read failed" (R12.5) is emitted at the caller layer (App.tsx
    // `setDocFromPath`'s null branch).
    logger.warn('failed to read file:', normalized, err);
    return null;
  }
}

/**
 * v1.0 (R-EDIT-5.1, PR-A): write the editor's buffer to disk at `path`.
 *
 * Thin wrapper around `writeTextFile` so EditModeProvider can stay
 * Tauri-agnostic and we keep the "all FS I/O lives in tauri.ts" pattern
 * the v0.1 codebase already follows for reads (`loadDocument`).
 *
 * The caller is responsible for:
 *   - Dirty tracking (EditModeProvider holds the bufferText state)
 *   - Toast on success / error (this layer only logs to the rolling
 *     log file on failure, then rethrows so the caller can show the
 *     toast in the same call site that owns user-facing UX text)
 *
 * Path semantics: the caller MUST pass an already-normalized absolute
 * path (typically `doc.path`, which `loadDocument` normalized for us).
 * We do NOT bump the recent list here — saving a file is not the same
 * as opening it; the watcher will receive the modification event and
 * the existing `skipRecent: true` reload path handles the consistency.
 *
 * The file watcher will fire its `file-changed` event for our own write
 * — the v1.0 conflict-handling in useFileWatcher (R-EDIT-8) is the
 * mechanism that prevents that from clobbering the buffer (the
 * editor's bufferText already matches the disk by the time the watcher
 * fires, so the dirty bit is false and the silent reload path is a
 * no-op for the user).
 */
export async function saveDocument(path: string, text: string): Promise<void> {
  const normalized = normalizePath(path);
  try {
    await writeTextFile(normalized, text);
  } catch (err) {
    logger.warn('failed to save file:', normalized, err);
    throw err;
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

// ---- File watcher (PR-5b, R2.6) -------------------------------------------

/** Begin watching `path` for external modifications. Replaces any
 *  currently-watched file. Errors are surfaced to the caller — the App
 *  hook silently logs them (a missing watcher is degraded UX, not fatal). */
export const startWatching = (path: string): Promise<void> =>
  invoke('start_watching', { path });

/** Stop the active file watcher. Idempotent (no-op if nothing watched). */
export const stopWatching = (): Promise<void> => invoke('stop_watching');
