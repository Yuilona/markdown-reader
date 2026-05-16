import {
  readSettings,
  writeSettings,
  DEFAULT_SETTINGS,
  type Settings,
} from './settings';
import * as logger from './logger';

/**
 * Cross-provider settings store (PR-9 hotfix).
 *
 * Why this module exists:
 *   Three providers (ThemeProvider, PageZoomProvider, App.tsx's
 *   showTocByDefault toggle) each used to read settings.json into a
 *   per-provider `persistedSettingsRef` snapshot at mount time and then
 *   write back with `writeSettings({ ...staleSnapshot, fieldX: newValue })`.
 *   When provider A wrote AFTER provider B had already updated fieldB,
 *   A's stale snapshot clobbered B's change — a last-write-wins race
 *   across providers.
 *
 *   This module centralizes the read AND serializes the writes:
 *     - `getSettings()` is a singleton accessor; first call triggers the
 *       read and caches the resulting Settings promise. Every subsequent
 *       call resolves to the live cached value (NOT a snapshot from a
 *       different mount instant).
 *     - `updateSettings(partial)` merges into the live cache and
 *       atomic-writes through a serialized queue, so concurrent calls
 *       from different providers can't interleave their `.tmp + rename`
 *       steps.
 *
 * Contract preserved:
 *   - The underlying `readSettings` / `writeSettings` / `DEFAULT_SETTINGS`
 *     surface in `settings.ts` is unchanged. Validation + corrupt-recovery
 *     (R10.8) still happen inside `readSettings`.
 *   - Atomic write semantics still come from `persistJson.ts`.
 *   - Persistence failures are logged via `logger.warn` (mirrors to
 *     console.warn + rolls into data/logs/app.log) — same call-site
 *     behavior the providers had before.
 *
 * Out of scope:
 *   - Subscribing other React components to settings changes. The three
 *     consumers all OWN the state they write (theme, pageZoom,
 *     showTocByDefault) and propagate changes through their own React
 *     state. The cache only needs to stay consistent across writes; reads
 *     still happen once per provider mount.
 */

/** Single shared read promise; populated lazily on the first
 *  `getSettings()` call. Reset to `null` by `invalidateSettingsCache`
 *  (test/debug-only escape hatch). */
let cachedPromise: Promise<Settings> | null = null;

/** Serialized write tail. Each `updateSettings` call chains onto this
 *  promise so the underlying atomic `.tmp + rename` dance happens in
 *  strict order. We never let one failure poison the chain (see the
 *  inner try/catch + the outer .catch reset). */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Resolve to the current Settings. The first call triggers a disk read
 * through the shared `readSettings`; subsequent calls return the cached
 * promise. After an `updateSettings`, the cache is replaced with the
 * merged value so a fresh `getSettings()` sees the just-written shape.
 *
 * Never throws — `readSettings` itself returns DEFAULT_SETTINGS on
 * missing/corrupt JSON (R10.8).
 */
export function getSettings(): Promise<Settings> {
  if (!cachedPromise) {
    cachedPromise = readSettings();
  }
  return cachedPromise;
}

/**
 * Merge `partial` into the cached Settings and atomically write the
 * result. Writes are serialized so two providers updating different
 * fields concurrently never lose each other's changes.
 *
 * The `version` field is pinned to the schema constant — callers cannot
 * (and should not) override it via `partial`.
 *
 * Persistence failures are logged but never thrown. The cache is updated
 * BEFORE the write so a subsequent read sees the intended value even if
 * the disk write transiently fails (this keeps the UI consistent across
 * remounts in a single session; a fresh app launch will fall back to
 * whatever made it to disk).
 */
export function updateSettings(
  partial: Partial<Omit<Settings, 'version'>>,
): Promise<Settings> {
  let result: Settings = { ...DEFAULT_SETTINGS };
  writeQueue = writeQueue.then(async () => {
    const current = await getSettings();
    const next: Settings = { ...current, ...partial, version: 1 };
    // Promote the cache BEFORE attempting the write so any concurrent
    // `getSettings()` resolves to the merged value even mid-write.
    cachedPromise = Promise.resolve(next);
    try {
      await writeSettings(next);
    } catch (err) {
      // Mirrors the prior per-provider behavior — log + swallow. A
      // persistence failure must not block the in-memory state change.
      logger.warn('settings write failed:', err);
    }
    result = next;
  });
  // Belt: if anything unexpected throws inside the chain above, reset
  // the queue to a resolved state so the NEXT updateSettings call still
  // gets scheduled instead of dying silently.
  writeQueue = writeQueue.catch((err) => {
    logger.warn('settings write queue error:', err);
  });
  return writeQueue.then(() => result);
}

/**
 * Test / debug escape hatch — drops the cached promise so the next
 * `getSettings()` re-reads from disk. Not used by production code paths.
 */
export function invalidateSettingsCache(): void {
  cachedPromise = null;
}
