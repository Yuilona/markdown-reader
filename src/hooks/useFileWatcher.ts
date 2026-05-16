import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

import { loadDocument, startWatching, stopWatching, type LoadedDocument } from '../lib/tauri';
import { pathsEqual } from '../lib/pathUtils';
import * as logger from '../lib/logger';

interface UseFileWatcherOptions {
  /** The path the app is currently displaying. `null` when on EmptyState. */
  currentPath: string | null;
  /**
   * Called with the freshly re-read document after a debounced
   * external-modification event. The caller swaps it into state
   * WITHOUT changing the path (so the scroll container stays mounted
   * and `useScrollMemory` doesn't re-run its restore path).
   */
  onReload: (doc: LoadedDocument) => void;
}

/**
 * File-watcher orchestration hook (R2.6).
 *
 * On `currentPath` change:
 *   - Stop any previous watcher.
 *   - If the new path is non-null, start watching it (Rust side
 *     `start_watching` command).
 *
 * For the lifetime of the hook, listen for the `file-changed` event the
 * Rust watcher emits (already debounced 200ms on the Rust side). When
 * it fires for the path we're currently displaying, re-read the file via
 * `loadDocument(path, { skipRecent: true })` and hand the result back
 * to the caller.
 *
 * The `skipRecent: true` matters: an external editor save should NOT
 * count as a "user opened this file" event — that would bubble the file
 * to the top of the recent list every time the user hits Ctrl+S in VS
 * Code, which is the opposite of useful.
 *
 * The `pathsEqual` guard inside the event handler protects against the
 * race where the watcher swap is in flight and the OS delivers one last
 * event from the previous path. (Stop/start aren't atomic on the OS
 * side.)
 */
export function useFileWatcher(options: UseFileWatcherOptions): void {
  const { currentPath, onReload } = options;

  // Start/stop watcher on path change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await stopWatching();
        if (cancelled || !currentPath) return;
        await startWatching(currentPath);
      } catch (err) {
        // PR-8: console mirror + rolling log file.
        logger.warn('failed to (re)start file watcher:', err);
      }
    })();
    return () => {
      cancelled = true;
      // Don't await — fire-and-forget stop is fine because the next
      // mount of this hook will call stopWatching again anyway. We DO
      // need to clear the listener in the other effect, though.
      void stopWatching().catch(() => undefined);
    };
  }, [currentPath]);

  // Listen for `file-changed` events. The listener closes over
  // `currentPath` + `onReload`, so this effect re-runs whenever either
  // changes — that's deliberate, so the equality guard against
  // `currentPath` is always against the freshest value (vs a stale-
  // closure trap). The brief unlisten-then-relisten gap during a path
  // swap doesn't matter because the Rust watcher is also being swapped
  // in the other effect — there's nothing to deliver in that window.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    listen<string>('file-changed', async (event) => {
      // The Rust side sends back the same absolute path string we passed
      // into `start_watching` (NOT the canonicalized form — see
      // file_watcher.rs's `emit_payload` comment). Compare against the
      // current path BEFORE we kick off the re-read — if the user
      // already switched documents, the stale event is uninteresting.
      const changedPath = event.payload;
      const active = currentPath;
      if (!active || !pathsEqual(changedPath, active)) return;
      const reloaded = await loadDocument(active, { skipRecent: true });
      // Re-check the cancellation flag AFTER the await. The user may
      // have closed / swapped documents while loadDocument was in
      // flight; in that case the cleanup function below already ran
      // and set `cancelled = true`. Without this guard we'd clobber
      // the freshly-loaded doc with stale content. (Without this we
      // also clobber the currentPath state if the user navigated.)
      if (cancelled || !reloaded) return;
      onReload(reloaded);
    })
      .then((un) => {
        if (cancelled) {
          un();
        } else {
          unlisten = un;
        }
      })
      .catch((err) => {
        logger.warn('failed to register file-changed listener:', err);
      });

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [currentPath, onReload]);
}
