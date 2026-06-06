import { normalizePath, pathsEqual } from './pathUtils';
import { atomicWriteJson, readJson } from './persistJson';
import * as logger from './logger';

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
 * In-memory cache (cr-performance #17):
 *   The parsed `positions` array is held in a module-level cache, read
 *   from disk exactly ONCE on first access. `saveScroll` mutates that
 *   array IN PLACE and only marks it dirty — it no longer re-reads,
 *   re-filters and rewrites the whole file on every 250ms scroll tick.
 *   `flushScroll` performs the actual atomic disk write and is called on
 *   a coarse cadence (the hook debounces ~1.5s) plus on doc-swap / unmount.
 *   `getScroll` / `clearScroll` semantics are unchanged from the caller's
 *   point of view; they just serve from / mutate the cache.
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

// ---- In-memory cache (cr-performance #17). ----
//
// `positions` becomes the single source of truth for the session once
// loaded. `saveScroll` / `clearScroll` mutate it directly and flip
// `dirty`; `flushScroll` writes it to disk. We never re-read the file
// after the first load — the cache IS the truth for this process.
let cachedPositions: ScrollEntry[] | null = null;
let loadPromise: Promise<ScrollEntry[]> | null = null;
let dirty = false;

/** Load (once) and return the live in-memory positions array. Concurrent
 *  first-callers share the single read promise. */
async function ensureLoaded(): Promise<ScrollEntry[]> {
  if (cachedPositions) return cachedPositions;
  if (!loadPromise) {
    loadPromise = readScrollPositions().then((file) => {
      // A racing caller may have populated the cache via clearScroll while
      // we were reading; prefer the existing cache if so.
      if (!cachedPositions) cachedPositions = file.positions;
      return cachedPositions;
    });
  }
  return loadPromise;
}

/**
 * Get the saved scroll Y for `path` if any. Returns `null` for files we
 * have no record of — caller starts at scrollTop 0. Served from the
 * in-memory cache (cr-performance #17); first call seeds it from disk.
 */
export async function getScroll(path: string): Promise<number | null> {
  const positions = await ensureLoaded();
  const found = positions.find((p) => pathsEqual(p.path, path));
  return found ? found.y : null;
}

/**
 * Save scroll Y for `path`. Bumps `lastTouched` and enforces the 100-entry
 * LRU bound by dropping the oldest entry on overflow. cr-performance #17:
 * this now mutates the in-memory array and marks it dirty — the actual
 * disk write is deferred to `flushScroll` (coarse debounce / doc-swap /
 * unmount). No more full read + filter + rewrite on every 250ms tick.
 *
 * Returns immediately after the in-memory mutation; never throws.
 */
export async function saveScroll(path: string, y: number): Promise<void> {
  if (!Number.isFinite(y)) return;
  const normalized = normalizePath(path);
  const positions = await ensureLoaded();
  // Move-to-front update: drop any existing entry for this path, unshift
  // the fresh one. Mutating the SAME array reference keeps `cachedPositions`
  // and any in-flight `ensureLoaded` resolution consistent.
  const existingIdx = positions.findIndex((p) => pathsEqual(p.path, normalized));
  if (existingIdx !== -1) positions.splice(existingIdx, 1);
  positions.unshift({
    path: normalized,
    y: Math.round(y),
    lastTouched: new Date().toISOString(),
  });
  if (positions.length > MAX_ENTRIES) {
    // Drop the oldest by lastTouched. Sort newest-first then truncate,
    // writing the result back into the SAME array reference.
    positions.sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
    positions.length = MAX_ENTRIES;
  }
  dirty = true;
}

/**
 * Flush the in-memory positions to disk if dirty (cr-performance #17).
 * Called on a coarse debounce by the hook plus on doc-swap / unmount.
 * No-op when nothing changed since the last flush. Silently swallows
 * write errors (logs warn) — a persistence failure must never disrupt
 * scrolling. The dirty flag clears optimistically before the write so a
 * concurrent `saveScroll` during the await re-marks it for the next flush.
 */
export async function flushScroll(): Promise<void> {
  if (!dirty || !cachedPositions) return;
  dirty = false;
  // Snapshot the array so a concurrent splice/unshift during the await
  // can't write a half-mutated shape (atomicWriteJson serializes the
  // object eagerly anyway, but copying keeps the contract explicit).
  const snapshot = cachedPositions.slice();
  try {
    await atomicWriteJson<ScrollPositionsFile>(FILE_NAME, {
      version: SCHEMA_VERSION,
      positions: snapshot,
    });
  } catch (err) {
    // Re-mark dirty so the next flush retries this lost write.
    dirty = true;
    // PR-8: console mirror + rolling log file (R10.9).
    logger.warn('failed to write scroll-positions.json (flush):', err);
  }
}

/**
 * Remove the scroll entry for `path`. Used when the user explicitly
 * "closes" or "forgets" a file. v0.1 doesn't expose this in UI yet but
 * the shape stays consistent with `removeRecent`. cr-performance #17:
 * mutates the cache in place and flushes immediately (explicit user
 * intent — don't risk losing it to a coarse debounce).
 */
export async function clearScroll(path: string): Promise<void> {
  const positions = await ensureLoaded();
  const before = positions.length;
  // Filter in place into the same array reference.
  const kept = positions.filter((p) => !pathsEqual(p.path, path));
  if (kept.length === before) return; // nothing to do
  positions.length = 0;
  positions.push(...kept);
  dirty = true;
  await flushScroll();
}

/**
 * Test-only escape hatch: drop the in-memory cache so the next access
 * re-reads from disk. Not used by production code paths.
 */
export function resetScrollCacheForTests(): void {
  cachedPositions = null;
  loadPromise = null;
  dirty = false;
}
