import { useEffect } from 'react';
import {
  availableMonitors,
  getCurrentWindow,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';

import {
  clampToVisibleBounds,
  readWindowState,
  saveWindowState,
  type WindowState,
} from '../lib/windowState';
import * as logger from '../lib/logger';

/**
 * Window-state persistence (R2.8, R10.1) — PR-9 hotfix.
 *
 * Lifecycle on mount:
 *   1. Read `<data>/window.json`. If present + valid:
 *      a. Query available monitors (R2.8 multi-monitor fallback).
 *      b. Clamp to visible bounds — off-screen geometry recenters on
 *         primary so a previously-attached external monitor that's now
 *         gone doesn't strand the window.
 *      c. If `maximized`, call `maximize()`. Otherwise `setSize` +
 *         `setPosition` with the saved physical pixels.
 *   2. Subscribe to `onResized`, `onMoved`, `onCloseRequested`. Resized
 *      and moved are debounced ~300ms so a drag's continuous stream of
 *      events only triggers one disk write.
 *   3. Also save on browser-level `beforeunload` as a belt-and-suspenders
 *      for the rare case where the window is killed without an
 *      orderly `onCloseRequested` (force-quit, OS shutdown).
 *
 * Idempotent re-mount: the hook intentionally returns no value. The
 * cleanup function tears down all listeners so React strict-mode's
 * double-mount in dev doesn't leave duplicate subscriptions.
 *
 * Restore failure is silent: if the saved file is corrupt, `null`
 * falls through to "no restore" and the app launches with the defaults
 * declared in `tauri.conf.json` — which is exactly what R10.8 mandates.
 *
 * Capabilities required (see src-tauri/capabilities/default.json):
 *   - core:window:allow-set-size
 *   - core:window:allow-set-position
 *   - core:window:allow-maximize
 *   - core:default already grants the read-only queries we use
 *     (inner-size, outer-position, is-maximized, available-monitors,
 *     primary-monitor).
 */
export function useWindowStatePersistence(): void {
  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    const unlistens: Array<() => void> = [];

    /** Snapshot the live window state and write it to disk. */
    const saveCurrent = async (): Promise<void> => {
      try {
        const [size, position, maximized] = await Promise.all([
          win.innerSize(),
          win.outerPosition(),
          win.isMaximized(),
        ]);
        const state: WindowState = {
          version: 1,
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height,
          maximized,
        };
        await saveWindowState(state);
      } catch (err) {
        // R10.8: persistence failures must never crash the app. Log and
        // continue — next event will retry.
        logger.warn('failed to save window state:', err);
      }
    };

    // Debounce wrapper. Returns a fire-and-forget callback suitable for
    // an event handler. The trailing-edge timer fires `saveCurrent`
    // 300ms after the last invocation, collapsing the drag-storm of
    // resize/move events into one disk write.
    const debouncedSave = makeDebouncedSave(saveCurrent, 300);

    // Restore + subscribe. Wrapped in an async IIFE so the effect's
    // synchronous return (the cleanup) can wire teardown immediately;
    // any restore-time `await`s run in the background while React mounts
    // the rest of the tree.
    void (async () => {
      try {
        const saved = await readWindowState();
        if (!cancelled && saved) {
          // Multi-monitor fallback (R2.8): re-fetch the monitor list at
          // restore time so a disconnected display since last shutdown is
          // detected. `availableMonitors` is in core:default.
          const [monitors, primary] = await Promise.all([
            availableMonitors(),
            primaryMonitor(),
          ]);
          if (cancelled) return;
          const fixed = clampToVisibleBounds(saved, monitors, primary);
          if (fixed.maximized) {
            // Set the inner geometry FIRST so the "restore from
            // maximize" rect the OS remembers points at the user's
            // last-non-maximized size; then maximize. If we skipped
            // this, double-clicking the titlebar to un-maximize would
            // restore to the tauri.conf.json defaults instead of the
            // user's preferred working size.
            await win.setSize(new PhysicalSize(fixed.width, fixed.height));
            await win.setPosition(new PhysicalPosition(fixed.x, fixed.y));
            await win.maximize();
          } else {
            await win.setSize(new PhysicalSize(fixed.width, fixed.height));
            await win.setPosition(new PhysicalPosition(fixed.x, fixed.y));
          }
        }
      } catch (err) {
        // Restore failure is non-fatal — the app continues with the
        // tauri.conf.json defaults. This covers the case where the
        // capabilities config is out of sync with this hook.
        logger.warn('failed to restore window state:', err);
      }

      if (cancelled) return;

      // Subscribe to live geometry events. Each `await` returns an
      // unlisten fn the cleanup below will call. We re-check `cancelled`
      // after each await so a quick unmount during dev (StrictMode
      // double-mount) doesn't leave a dangling subscription.
      try {
        const unResized = await win.onResized(() => debouncedSave());
        if (cancelled) {
          unResized();
        } else {
          unlistens.push(unResized);
        }

        const unMoved = await win.onMoved(() => debouncedSave());
        if (cancelled) {
          unMoved();
        } else {
          unlistens.push(unMoved);
        }

        // R2.8: capture the FINAL state on close — onResized/onMoved
        // can lose a trailing edit if the user closes within the 300ms
        // debounce window. Close handler awaits the save so the disk
        // write completes before Tauri tears the window down.
        const unClose = await win.onCloseRequested(async () => {
          debouncedSave.flush();
          await saveCurrent();
        });
        if (cancelled) {
          unClose();
        } else {
          unlistens.push(unClose);
        }
      } catch (err) {
        logger.warn('failed to subscribe to window events:', err);
      }
    })();

    // Belt: a `beforeunload` save for the force-quit / OS-shutdown case
    // where Tauri's `onCloseRequested` may not fire. Best-effort; the
    // browser only gives us a synchronous tick here so we can't await.
    const onBeforeUnload = (): void => {
      // Fire-and-forget; the atomic-write happens through the same
      // `.tmp + rename` path as the regular save. Even if we never
      // resolve, the OS may flush the .tmp; next launch's corrupt-
      // recovery handles a partial write.
      void saveCurrent();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      for (const fn of unlistens) {
        try {
          fn();
        } catch {
          // Listener cleanup must never throw — Tauri's unlisten
          // implementation occasionally races during shutdown.
        }
      }
      debouncedSave.cancel();
    };
  }, []);
}

/** Debounce helper specialized for "save on trailing edge" semantics.
 *  Returns a function with `.flush()` and `.cancel()` — both currently
 *  drop the pending timer WITHOUT firing the callback (see the
 *  `clearPending` comment for the race-avoidance reason). The names
 *  reflect call-site intent: `flush` is called when the caller plans to
 *  invoke the underlying save explicitly right after; `cancel` is used
 *  during cleanup when no save is desired. */
interface DebouncedSave {
  (): void;
  flush: () => void;
  cancel: () => void;
}

function makeDebouncedSave(fn: () => void | Promise<void>, delayMs: number): DebouncedSave {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (): void => {
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      void fn();
    }, delayMs);
  };
  // Both `flush` and `cancel` clear the pending timer WITHOUT firing the
  // callback. The close-requested handler immediately calls saveCurrent()
  // after `flush()` to capture the up-to-date geometry; firing the
  // (potentially stale) pending callback first would risk a parallel
  // atomic .tmp + rename dance with the explicit saveCurrent() — they'd
  // race on the same `window.json.tmp` path. The cleanup path uses
  // `cancel()` for the same reason: no save desired, just drop the
  // pending timer so the dev-hot-reload doesn't leak a callback into a
  // stale closure.
  const clearPending = (): void => {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  };
  (wrapped as DebouncedSave).flush = clearPending;
  (wrapped as DebouncedSave).cancel = clearPending;
  return wrapped as DebouncedSave;
}
