import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

import { loadDocument, startWatching, stopWatching, type LoadedDocument } from '../lib/tauri';
import { pathsEqual } from '../lib/pathUtils';
import { useToast } from '../components/Toast/useToast';
import { useEditMode } from '../components/EditModeProvider/useEditMode';
import { useConfirm } from '../components/ConfirmDialog/useConfirm';
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
 *
 * v1.0 PR-A — conflict handling (R-EDIT-8):
 *   The behavior branches on the current EditMode + dirty bit:
 *
 *   - mode === 'read'                     → silent reload (v0.1 behavior)
 *   - mode === 'edit' && !dirty           → silent reload + info toast
 *                                           "外部修改已同步"
 *   - mode === 'edit' && dirty            → DO NOT auto-reload. Show a
 *                                           confirm dialog with two
 *                                           options: [重载（丢弃我的修
 *                                           改）] [保留我的修改]
 *
 *   "Save the watcher's own self-fire": when we save the file ourselves
 *   via Ctrl+S, the watcher will fire shortly after. At that moment our
 *   bufferText already matches the disk content (the save flow updated
 *   doc.text via onDocTextSync), so the `dirty` bit is false — we take
 *   the silent-reload branch. The silent reload then no-ops in
 *   EditModeProvider because doc.text === bufferText already (the
 *   reset effect sees no change).
 */
export function useFileWatcher(options: UseFileWatcherOptions): void {
  const { currentPath, onReload } = options;
  const toast = useToast();
  const { mode, dirty, bufferText } = useEditMode();
  const confirm = useConfirm();

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
  //
  // v1.0 PR-A: `mode`, `dirty`, `bufferText`, `toast`, and `confirm`
  // are also dependencies because the conflict-handling branches on
  // mode + dirty. Stale-closure bugs here would be the worst kind of
  // user-visible data loss (the user types something, the file watcher
  // fires, and we silent-reload past their unsaved edits).
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

      // Pre-read snapshot of mode + dirty + bufferText. These come from
      // the effect's deps, so they're the latest values at the time
      // the watcher fired.
      const currentMode = mode;
      const currentDirty = dirty;
      const currentBufferText = bufferText;

      const reloaded = await loadDocument(active, { skipRecent: true });
      // Re-check the cancellation flag AFTER the await. The user may
      // have closed / swapped documents while loadDocument was in
      // flight; in that case the cleanup function below already ran
      // and set `cancelled = true`. Without this guard we'd clobber
      // the freshly-loaded doc with stale content. (Without this we
      // also clobber the currentPath state if the user navigated.)
      if (cancelled || !reloaded) return;

      // Self-write detection: when WE wrote the file (via Ctrl+S), the
      // watcher fires almost immediately afterwards. By the time it
      // does, our bufferText equals the just-written text equals the
      // disk content. If reloaded.text === currentBufferText, this
      // event is OUR write echoing back — treat as silent reload with
      // NO toast and NO conflict prompt, regardless of mode.
      if (reloaded.text === currentBufferText) {
        onReload(reloaded);
        return;
      }

      // Read mode: v0.1 silent reload (R-EDIT-8.4).
      if (currentMode === 'read') {
        onReload(reloaded);
        return;
      }

      // Edit mode + clean buffer: silent reload + info toast (R-EDIT-8.3).
      if (!currentDirty) {
        onReload(reloaded);
        toast.show('外部修改已同步', { variant: 'info', duration: 2000 });
        return;
      }

      // Edit mode + dirty buffer: prompt the user (R-EDIT-8.2). We do
      // NOT call onReload here — onReload swaps doc.text which
      // EditModeProvider's reset effect would happily overwrite the
      // user's buffer.
      const choice = await confirm({
        title: '外部修改冲突',
        message: '当前文件已被其他程序修改。是否重载（这将丢弃你当前的编辑）？',
        buttons: [
          { value: 'keep', label: '保留我的修改', variant: 'secondary' },
          { value: 'reload', label: '重载（丢弃修改）', variant: 'danger' },
        ],
        cancelValue: 'keep',
      });
      if (cancelled) return;
      if (choice === 'reload') {
        // Re-read NOW (the original `reloaded` may be stale by the time
        // the user clicks). Two reads in the worst case — that's fine,
        // the user explicitly asked for "what's on disk right now".
        const freshLoad = await loadDocument(active, { skipRecent: true });
        if (cancelled || !freshLoad) return;
        onReload(freshLoad);
      }
      // 'keep' branch: do nothing. The buffer stays as-is. The user's
      // next Ctrl+S will overwrite the disk with their version.
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
  }, [currentPath, onReload, mode, dirty, bufferText, toast, confirm]);
}
