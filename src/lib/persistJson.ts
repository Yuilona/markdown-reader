import { readTextFile, writeTextFile, rename, exists } from '@tauri-apps/plugin-fs';

import { getDataDir } from './tauri';
import * as logger from './logger';

/**
 * Generic atomic-write helper for the small JSON files we persist under
 * `<install_dir>/data/`. Shared by `recent.json` (PR-5a) and
 * `scroll-positions.json` (PR-5b).
 *
 * Atomic-write contract:
 *   1. JSON-serialize the value (pretty-printed for human inspection — the
 *      files are small and a stray .tmp left behind is easier to debug
 *      when it's readable).
 *   2. Write the bytes to `<name>.tmp`.
 *   3. `rename` the tmp file over the real file. On Windows the Tauri fs
 *      plugin uses `std::fs::rename`, which is atomic for overwrite-rename
 *      on the same volume — the data dir lives in `<install_dir>/data/`
 *      so this is always satisfied.
 *
 * If the app is killed mid-write, the original file is preserved intact.
 * R10.8 then handles the "what if the original itself is corrupt" path
 * inside each reader (`parseRecent`, `parseScrollPositions`, etc).
 *
 * The function does NOT swallow errors — callers wrap it in their own
 * try/catch + console.warn so they can decide whether a persistence
 * failure should bubble or be silent.
 */
export interface PersistResult {
  /** Real on-disk path the file ended up at. Useful for logging. */
  path: string;
}

/** Read + parse a JSON file under the data dir. Returns `null` if the
 * file doesn't exist OR fails to parse — the caller decides how to
 * recover (typically: return an empty default). */
export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const dir = await getDataDir();
    const p = joinDataPath(name, dir);
    if (!(await exists(p))) {
      return null;
    }
    const raw = await readTextFile(p);
    return JSON.parse(raw) as T;
  } catch (err) {
    // Console mirror + rolling log file (R10.8 corrupt recovery, R10.9
    // logging). The logger.warn call internally calls console.warn so
    // the previous behaviour is preserved without a duplicate console
    // line.
    logger.warn(`failed to read ${name}:`, err);
    return null;
  }
}

/** Atomic write of `data` (JSON-serialized) to `<dataDir>/<name>`. */
export async function atomicWriteJson<T>(name: string, data: T): Promise<PersistResult> {
  const dir = await getDataDir();
  const realPath = joinDataPath(name, dir);
  const tmpPath = joinDataPath(`${name}.tmp`, dir);
  const json = JSON.stringify(data, null, 2);
  await writeTextFile(tmpPath, json);
  await rename(tmpPath, realPath);
  return { path: realPath };
}

/**
 * Manual join: the Rust `get_data_dir` command returns an absolute Windows
 * path without a trailing separator. Avoiding `@tauri-apps/api/path` here
 * keeps this helper synchronous-shaped and skips an extra IPC round-trip
 * per write.
 */
function joinDataPath(name: string, dir: string): string {
  return `${dir}\\${name}`;
}
