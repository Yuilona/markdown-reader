import { normalizePath, pathsEqual } from './pathUtils';
import { atomicWriteJson, readJson } from './persistJson';

/**
 * Scroll-position memory (R10.4).
 *
 * Layout: `<install_dir>/data/scroll-positions.json`
 * Schema:
 *   {
 *     "version": 1,
 *     "positions": [
 *       { "path": "C:\\foo\\bar.md", "y": 1234, "lastTouched": "2026-..." }
 *     ]
 *   }
 *
 * Semantics:
 *   - On every save (`saveScroll`), the entry's `lastTouched` is bumped
 *     to `new Date().toISOString()`.
 *   - On overflow past MAX_ENTRIES, the entry with the OLDEST
 *     `lastTouched` is dropped.
 *   - Path equality is case-insensitive (Windows semantics) via
 *     `pathsEqual`. Storage format is backslash-form (same as
 *     `recent.json`).
 *   - Atomic write goes through `atomicWriteJson` from `persistJson.ts`
 *     (extracted in PR-5b to share with `recent.json`).
 *   - Corrupt / missing JSON: silently reset (R10.8). The caller
 *     (`getScroll`) returns `null` so the document opens at top.
 *
 * The hook (`useScrollMemory`) debounces saves to ~250ms in the React
 * layer — this lib stays synchronous-shaped so the hook can compose
 * easily.
 */

const FILE_NAME = 'scroll-positions.json';
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 100;

export interface ScrollEntry {
  path: string;
  y: number;
  /** ISO 8601 timestamp string. */
  lastTouched: string;
}

export interface ScrollPositionsFile {
  version: number;
  positions: ScrollEntry[];
}

/** Validate the shape of a parsed scroll-positions.json. */
function validate(parsed: unknown): ScrollPositionsFile {
  if (
    parsed &&
    typeof parsed === 'object' &&
    'positions' in parsed &&
    Array.isArray((parsed as { positions: unknown }).positions)
  ) {
    const obj = parsed as { version?: number; positions: unknown[] };
    const positions: ScrollEntry[] = [];
    for (const entry of obj.positions) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as ScrollEntry).path === 'string' &&
        typeof (entry as ScrollEntry).y === 'number' &&
        typeof (entry as ScrollEntry).lastTouched === 'string' &&
        Number.isFinite((entry as ScrollEntry).y)
      ) {
        positions.push({
          path: (entry as ScrollEntry).path,
          y: (entry as ScrollEntry).y,
          lastTouched: (entry as ScrollEntry).lastTouched,
        });
      }
    }
    return { version: SCHEMA_VERSION, positions: positions.slice(0, MAX_ENTRIES) };
  }
  return { version: SCHEMA_VERSION, positions: [] };
}

/** Read scroll-positions.json. Empty default on missing / corrupt. */
export async function readScrollPositions(): Promise<ScrollPositionsFile> {
  const raw = await readJson<unknown>(FILE_NAME);
  if (raw === null) {
    return { version: SCHEMA_VERSION, positions: [] };
  }
  return validate(raw);
}

/**
 * Get the saved scroll Y for `path` if any. Returns `null` for files we
 * have no record of — caller starts at scrollTop 0.
 */
export async function getScroll(path: string): Promise<number | null> {
  const file = await readScrollPositions();
  const found = file.positions.find((p) => pathsEqual(p.path, path));
  return found ? found.y : null;
}

/**
 * Save scroll Y for `path`. Bumps `lastTouched` on every write. Enforces
 * the 100-entry LRU bound by dropping the oldest entry when overflowing.
 *
 * Silently swallows write errors (logs warn) — a persistence failure must
 * never disrupt scrolling.
 */
export async function saveScroll(path: string, y: number): Promise<void> {
  if (!Number.isFinite(y)) return;
  const normalized = normalizePath(path);
  const current = await readScrollPositions();
  const others = current.positions.filter((p) => !pathsEqual(p.path, normalized));
  const updated: ScrollEntry = {
    path: normalized,
    y: Math.round(y),
    lastTouched: new Date().toISOString(),
  };
  let next: ScrollEntry[] = [updated, ...others];
  if (next.length > MAX_ENTRIES) {
    // Drop the oldest by lastTouched. Sort newest-first then truncate.
    next = next
      .slice()
      .sort((a, b) => b.lastTouched.localeCompare(a.lastTouched))
      .slice(0, MAX_ENTRIES);
  }
  try {
    await atomicWriteJson<ScrollPositionsFile>(FILE_NAME, {
      version: SCHEMA_VERSION,
      positions: next,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to write scroll-positions.json:', err);
  }
}

/**
 * Remove the scroll entry for `path`. Used when the user explicitly
 * "closes" or "forgets" a file. v0.1 doesn't expose this in UI yet but
 * the shape stays consistent with `removeRecent`.
 */
export async function clearScroll(path: string): Promise<void> {
  const current = await readScrollPositions();
  const filtered = current.positions.filter((p) => !pathsEqual(p.path, path));
  if (filtered.length === current.positions.length) return; // nothing to do
  try {
    await atomicWriteJson<ScrollPositionsFile>(FILE_NAME, {
      version: SCHEMA_VERSION,
      positions: filtered,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to write scroll-positions.json:', err);
  }
}
