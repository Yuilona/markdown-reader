import { exists, remove } from '@tauri-apps/plugin-fs';

import { getDataDir } from './tauri';
import { normalizePath, pathsEqual } from './pathUtils';
import { atomicWriteJson, readJson } from './persistJson';
import * as logger from './logger';

/**
 * Recent-files persistence (R10.3).
 *
 * Layout: `<install_dir>/data/recent.json`
 * Schema: `{ version: 1, files: [{ path, lastOpened }] }`
 *
 * Semantics:
 *   - LRU: every successful open prepends + dedups + truncates to MAX.
 *   - Atomic write: write to `.tmp`, then `rename` over the real file.
 *     (Pattern extracted into `persistJson.ts` in PR-5b and shared with
 *     `scrollPositions.ts`.)
 *   - Corrupt JSON: silently treated as empty + `console.warn` (R10.8).
 *
 * Path scheme: we store backslash-form (Windows native). Dedup is
 * case-insensitive. See `pathUtils.ts`.
 */

const MAX_ENTRIES = 10;
const FILE_NAME = 'recent.json';
const TMP_NAME = 'recent.json.tmp';
const SCHEMA_VERSION = 1;

export interface RecentEntry {
  path: string;
  /** ISO 8601 timestamp string. */
  lastOpened: string;
}

export interface RecentList {
  version: number;
  files: RecentEntry[];
}

/** Validate the shape of a parsed recent.json. Anything malformed gets
 * coerced to an empty list — we never throw past this boundary. */
function validateRecent(parsed: unknown): RecentList {
  if (
    parsed &&
    typeof parsed === 'object' &&
    'files' in parsed &&
    Array.isArray((parsed as { files: unknown }).files)
  ) {
    const obj = parsed as { version?: number; files: unknown[] };
    const files: RecentEntry[] = [];
    for (const entry of obj.files) {
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as RecentEntry).path === 'string' &&
        typeof (entry as RecentEntry).lastOpened === 'string'
      ) {
        files.push({
          path: (entry as RecentEntry).path,
          lastOpened: (entry as RecentEntry).lastOpened,
        });
      }
    }
    return { version: SCHEMA_VERSION, files: files.slice(0, MAX_ENTRIES) };
  }
  return { version: SCHEMA_VERSION, files: [] };
}

/** Read recent.json from disk. Returns an empty list if missing or corrupt. */
export async function readRecent(): Promise<RecentList> {
  const raw = await readJson<unknown>(FILE_NAME);
  if (raw === null) {
    return { version: SCHEMA_VERSION, files: [] };
  }
  return validateRecent(raw);
}

/**
 * Prepend `absolutePath` to recent.json, dedup case-insensitively,
 * truncate to MAX_ENTRIES, then atomic-write.
 *
 * Silently swallows write errors (logs warn) — we never want a recent-list
 * write failure to break the actual file open.
 */
export async function pushRecent(absolutePath: string): Promise<RecentList> {
  const normalized = normalizePath(absolutePath);
  const current = await readRecent();
  const filtered = current.files.filter((e) => !pathsEqual(e.path, normalized));
  const next: RecentList = {
    version: SCHEMA_VERSION,
    files: [
      { path: normalized, lastOpened: new Date().toISOString() },
      ...filtered,
    ].slice(0, MAX_ENTRIES),
  };
  try {
    await atomicWriteJson(FILE_NAME, next);
  } catch (err) {
    // Console mirror + rolling log file (PR-8). logger.warn writes to
    // console.warn AND appends a line to data/logs/app.log.
    logger.warn('failed to write recent.json (push):', err);
  }
  return next;
}

/**
 * Remove a single entry by path (case-insensitive). Used by the "✕"
 * delete button on each recent row.
 */
export async function removeRecent(absolutePath: string): Promise<RecentList> {
  const current = await readRecent();
  const next: RecentList = {
    version: SCHEMA_VERSION,
    files: current.files.filter((e) => !pathsEqual(e.path, absolutePath)),
  };
  try {
    await atomicWriteJson(FILE_NAME, next);
  } catch (err) {
    logger.warn('failed to write recent.json (remove):', err);
  }
  return next;
}

/**
 * Best-effort cleanup of leftover `.tmp` files from a previous run that
 * was killed mid-write. Not awaited by callers — fire and forget on
 * startup is enough. Covers both `recent.json.tmp` (PR-5a) and
 * `scroll-positions.json.tmp` (PR-5b).
 */
export async function cleanupStaleTemp(): Promise<void> {
  try {
    const dir = await getDataDir();
    for (const tmpName of [TMP_NAME, 'scroll-positions.json.tmp']) {
      const tmpPath = `${dir}\\${tmpName}`;
      if (await exists(tmpPath)) {
        await remove(tmpPath);
      }
    }
  } catch {
    // ignore
  }
}
