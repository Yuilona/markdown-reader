import { readTextFile, writeTextFile, rename, remove, exists } from '@tauri-apps/plugin-fs';

import { getDataDir } from './tauri';
import { normalizePath, pathsEqual } from './pathUtils';

/**
 * Recent-files persistence (R10.3).
 *
 * Layout: `<install_dir>/data/recent.json`
 * Schema: `{ version: 1, files: [{ path, lastOpened }] }`
 *
 * Semantics:
 *   - LRU: every successful open prepends + dedups + truncates to MAX.
 *   - Atomic write: write to `.tmp`, then `rename` over the real file.
 *     If the app is killed mid-write, the original is preserved (R10.8
 *     handles the corrupt-file recovery side — we want to AVOID corruption
 *     in the first place).
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

let cachedDataDir: string | null = null;
async function dataDir(): Promise<string> {
  if (!cachedDataDir) cachedDataDir = await getDataDir();
  return cachedDataDir;
}

function joinDataPath(name: string, dir: string): string {
  // Manual join: dataDir() returns an absolute Windows path without a trailing
  // separator (see Rust side). Avoid an extra round-trip to @tauri-apps/api/path.
  return `${dir}\\${name}`;
}

/** Parse + validate. Returns an empty list on any failure. */
function parseRecent(raw: string): RecentList {
  try {
    const parsed = JSON.parse(raw) as unknown;
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] recent.json malformed; resetting:', err);
  }
  return { version: SCHEMA_VERSION, files: [] };
}

/** Read recent.json from disk. Returns an empty list if missing or corrupt. */
export async function readRecent(): Promise<RecentList> {
  try {
    const dir = await dataDir();
    const path = joinDataPath(FILE_NAME, dir);
    if (!(await exists(path))) {
      return { version: SCHEMA_VERSION, files: [] };
    }
    const raw = await readTextFile(path);
    return parseRecent(raw);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to read recent.json:', err);
    return { version: SCHEMA_VERSION, files: [] };
  }
}

/**
 * Atomic write: `tmp` first, then `rename` over the real file.
 * On Windows, `rename` over an existing file is supported by the Tauri fs
 * plugin (which uses `std::fs::rename` under the hood).
 */
async function writeRecent(list: RecentList): Promise<void> {
  const dir = await dataDir();
  const realPath = joinDataPath(FILE_NAME, dir);
  const tmpPath = joinDataPath(TMP_NAME, dir);
  const json = JSON.stringify(list, null, 2);
  await writeTextFile(tmpPath, json);
  await rename(tmpPath, realPath);
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
    await writeRecent(next);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to write recent.json:', err);
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
    await writeRecent(next);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to write recent.json:', err);
  }
  return next;
}

/**
 * Best-effort cleanup of a leftover `.tmp` file (e.g., previous run was
 * killed mid-write). Not awaited by callers — fire and forget on startup
 * is enough.
 */
export async function cleanupStaleTemp(): Promise<void> {
  try {
    const dir = await dataDir();
    const tmpPath = joinDataPath(TMP_NAME, dir);
    if (await exists(tmpPath)) {
      await remove(tmpPath);
    }
  } catch {
    // ignore
  }
}
