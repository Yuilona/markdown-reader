import type { Monitor } from '@tauri-apps/api/window';

import { atomicWriteJson, readJson } from './persistJson';

/**
 * Window-state persistence (R2.8, R10.1) — PR-9 hotfix.
 *
 * Layout: `<install_dir>/data/window.json`
 * Schema:
 *   {
 *     "version": 1,
 *     "x": <physical px>,
 *     "y": <physical px>,
 *     "width": <physical px>,
 *     "height": <physical px>,
 *     "maximized": <bool>
 *   }
 *
 * Why physical pixels:
 *   Tauri's `innerSize()` / `outerPosition()` return PhysicalSize /
 *   PhysicalPosition; the Monitor structs we use for off-screen-clamp
 *   logic also live in physical units. Storing physical end-to-end
 *   avoids `scaleFactor` round-trip drift between save and restore.
 *   Restore converts back to PhysicalSize / PhysicalPosition before
 *   calling `setSize` / `setPosition`.
 *
 * Atomic write + corrupt recovery (R10.8) come from `persistJson.ts`.
 * `readWindowState` returns `null` for missing or malformed JSON; the
 * caller falls back to the defaults declared in `tauri.conf.json`.
 *
 * No new Tauri plugin: this module uses the existing fs plugin via
 * `persistJson.ts` and reads/writes happen from the React side. Keeps
 * the bundle smaller than `tauri-plugin-window-state` would.
 */

const FILE_NAME = 'window.json';
const SCHEMA_VERSION = 1 as const;

/** Minimum on-screen overlap a restored window must have with any
 *  monitor for us to consider its saved position valid. Below this we
 *  treat the previous monitor as "gone" and re-center on primary. */
const MIN_VISIBLE_OVERLAP_PX = 100;

export interface WindowState {
  version: typeof SCHEMA_VERSION;
  /** Outer-position X in physical pixels (relative to the virtual
   *  desktop, can be negative on multi-monitor setups). */
  x: number;
  /** Outer-position Y in physical pixels. */
  y: number;
  /** Inner-size width in physical pixels. */
  width: number;
  /** Inner-size height in physical pixels. */
  height: number;
  /** Whether the window was maximized at save time. When true, the
   *  restore path calls `maximize()` instead of `setSize`/`setPosition`,
   *  and the saved x/y/width/height represent the "restore" geometry
   *  the OS will return to on un-maximize. */
  maximized: boolean;
}

/** Coerce an arbitrary parsed value into a valid WindowState or null.
 *  Any missing / wrong-type field invalidates the entire record — a
 *  partially valid window-state is more dangerous than no record
 *  (it could place the window at NaN,0). */
function validate(parsed: unknown): WindowState | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<WindowState>;
  const fields: Array<keyof Pick<WindowState, 'x' | 'y' | 'width' | 'height'>> =
    ['x', 'y', 'width', 'height'];
  for (const k of fields) {
    if (typeof obj[k] !== 'number' || !Number.isFinite(obj[k] as number)) {
      return null;
    }
  }
  if (typeof obj.maximized !== 'boolean') return null;
  // Width / height must be positive — a 0-dimension window is unusable
  // and is the most common "looks valid but breaks restore" failure.
  if ((obj.width as number) <= 0 || (obj.height as number) <= 0) return null;
  return {
    version: SCHEMA_VERSION,
    x: Math.round(obj.x as number),
    y: Math.round(obj.y as number),
    width: Math.round(obj.width as number),
    height: Math.round(obj.height as number),
    maximized: obj.maximized,
  };
}

/** Read window.json from disk. Returns null if the file is missing or
 *  the JSON is corrupt — the caller should fall back to the defaults
 *  declared in `tauri.conf.json`. */
export async function readWindowState(): Promise<WindowState | null> {
  const raw = await readJson<unknown>(FILE_NAME);
  if (raw === null) return null;
  return validate(raw);
}

/** Atomic-write `state` to window.json. Errors surface to the caller so
 *  the hook can `logger.warn` at the call site (parity with the other
 *  persistence modules). */
export async function saveWindowState(state: WindowState): Promise<void> {
  await atomicWriteJson<WindowState>(FILE_NAME, state);
}

/**
 * R2.8 fallback: if the saved position would place the window's title
 * bar outside every available monitor, recenter on the primary monitor.
 * "Outside" is defined as no monitor work-area overlapping the window
 * rect by at least MIN_VISIBLE_OVERLAP_PX on each axis — captures the
 * "previous external monitor was unplugged" case without rejecting a
 * window that's merely partially off-screen (Windows itself happily
 * restores those).
 *
 * Pure function — no Tauri imports, fully unit-testable. The caller
 * (`useWindowStatePersistence`) supplies the monitor list it queried
 * via `availableMonitors()` / `primaryMonitor()`.
 *
 * Width/height are also clamped to the primary monitor's work area so
 * a saved 4K geometry doesn't spill off the edges of a 1080p screen
 * after a monitor swap.
 */
export function clampToVisibleBounds(
  state: WindowState,
  monitors: Monitor[],
  primary: Monitor | null,
): WindowState {
  if (monitors.length === 0) {
    // No monitor info — leave the saved geometry alone. The OS will
    // place the window somewhere reasonable. This is also the path the
    // unit test for the "permissions denied" edge case exercises.
    return state;
  }

  const visible = monitors.some((m) => overlapsByAtLeast(state, m, MIN_VISIBLE_OVERLAP_PX));
  if (visible) return state;

  // Off-screen: recenter on the primary monitor (falling back to the
  // first available monitor if `primary` is null).
  const target = primary ?? monitors[0];
  const workArea = target.workArea;
  // Constrain width/height so we don't exceed the target monitor's
  // work area. Subtract a small inset on each side so the window edges
  // don't kiss the screen edges after the recenter.
  const inset = 40; // physical px
  const maxW = Math.max(200, workArea.size.width - inset * 2);
  const maxH = Math.max(200, workArea.size.height - inset * 2);
  const width = Math.min(state.width, maxW);
  const height = Math.min(state.height, maxH);
  const x = workArea.position.x + Math.round((workArea.size.width - width) / 2);
  const y = workArea.position.y + Math.round((workArea.size.height - height) / 2);
  return {
    version: SCHEMA_VERSION,
    x,
    y,
    width,
    height,
    maximized: state.maximized,
  };
}

/** Rect-vs-monitor overlap in BOTH axes by at least `threshold` px. */
function overlapsByAtLeast(state: WindowState, monitor: Monitor, threshold: number): boolean {
  const w = monitor.workArea;
  const overlapX = Math.min(state.x + state.width, w.position.x + w.size.width) -
    Math.max(state.x, w.position.x);
  const overlapY = Math.min(state.y + state.height, w.position.y + w.size.height) -
    Math.max(state.y, w.position.y);
  return overlapX >= threshold && overlapY >= threshold;
}
