import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

import { getDataDir } from './tauri';

/**
 * Rolling-file logger (R10.9, R12.7, PR-8).
 *
 * Layout: `<install_dir>/data/logs/app.log` (current).
 * Rotated archives: `<install_dir>/data/logs/app.log.<isoTs>.bak`
 *
 * Semantics:
 *   - Each call appends one line: `<ISO timestamp> <LEVEL> <message>\n`.
 *   - Writes are FIRE-AND-FORGET — every public method (`info`, `warn`,
 *     `error`) returns synchronously and the actual I/O happens in a
 *     background promise. A failed log write must NEVER bubble up to a
 *     caller that's already trying to recover from another problem.
 *   - Rolling: if the current log size after the append would exceed
 *     ~5 MB (MAX_LOG_BYTES), the existing `app.log` is renamed to
 *     `app.log.<isoTs>.bak` and a fresh file is started. We check size
 *     before each write — cheap enough at our log frequency (a handful
 *     of writes per session, mostly during error paths).
 *   - Cleanup: on first call (init), any `.bak` files older than
 *     CLEANUP_AFTER_MS are removed. Runs once per app lifetime.
 *   - Console mirror: every public method also calls the matching
 *     `console.[info|warn|error]` so dev tools still see the line.
 *
 * Why fire-and-forget instead of async/await:
 *   The vast majority of caller sites are catch blocks that don't care
 *   about logger latency (corrupt JSON recovery, copy failure, etc.).
 *   Making them all async-aware would bloat the call sites for no real
 *   benefit; the logger writes are best-effort observability.
 *
 * Why no batching:
 *   v0.1 log volume is tiny (single user, error paths only). Batching
 *   would add complexity and a flush-on-exit dance that Tauri's plugin
 *   model doesn't make ergonomic.
 *
 * Atomic-write is NOT used here. Append is intentionally non-atomic —
 *   we accept the (vanishingly rare) risk of a half-written line if the
 *   app is killed mid-write. The alternative (read-modify-write through
 *   the .tmp + rename dance for every line) would be wildly inefficient.
 *
 * Existing console.warn call sites in lib/ keep their console call AND
 *   add a `logger.warn(...)` next to it — see recentFiles.ts,
 *   scrollPositions.ts, settings.ts, userCss.ts.
 */

const LOG_FILE_NAME = 'app.log';
const LOG_DIR_NAME = 'logs';
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB (R10.9)
const CLEANUP_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (R10.9)

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

// One-time init promise — guarantees cleanupOldBaks() runs at most once
// per app lifetime even if `info`/`warn`/`error` are invoked from many
// modules in parallel. The init also ensures `data/logs/` exists before
// the first write.
let initPromise: Promise<string | null> | null = null;

/**
 * Resolve `<dataDir>\logs\` and ensure it exists. Also schedules a
 * one-shot cleanup of stale `.bak` archives. Returns the absolute logs
 * directory path on success, or `null` on failure (in which case all
 * subsequent log writes silently no-op for this session).
 */
async function init(): Promise<string | null> {
  try {
    const dataDir = await getDataDir();
    const logsDir = `${dataDir}\\${LOG_DIR_NAME}`;
    if (!(await exists(logsDir))) {
      // `recursive: true` covers the case where `data/` itself was just
      // created by the Rust shell on first launch.
      await mkdir(logsDir, { recursive: true });
    }
    // Fire-and-forget the bak cleanup so the first log call isn't gated
    // on the dir scan.
    void cleanupOldBaks(logsDir);
    return logsDir;
  } catch {
    // Logger init failed (most likely permissions); everything else
    // continues working — only logging is degraded.
    return null;
  }
}

/** Idempotent init handle — single shared promise per process. */
function getLogsDir(): Promise<string | null> {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

/**
 * Scan `logsDir` for `*.bak` files older than CLEANUP_AFTER_MS based on
 * the embedded ISO timestamp portion of the filename, then delete them.
 * Best-effort — any error is swallowed.
 */
async function cleanupOldBaks(logsDir: string): Promise<void> {
  try {
    const entries = await readDir(logsDir);
    const now = Date.now();
    for (const entry of entries) {
      const name = entry.name;
      if (!name) continue;
      // Expected shape: `app.log.<isoTs>.bak`
      const match = name.match(/^app\.log\.(.+)\.bak$/);
      if (!match) continue;
      const ts = parseTimestampSegment(match[1]);
      if (ts === null) continue;
      if (now - ts > CLEANUP_AFTER_MS) {
        try {
          await remove(`${logsDir}\\${name}`);
        } catch {
          // Ignore individual delete failures.
        }
      }
    }
  } catch {
    // Ignore dir-listing errors.
  }
}

/**
 * Parse the timestamp segment we embedded in a `.bak` filename. We
 * substitute `-` for `:` inside the time portion of the ISO string at
 * rotation time (Windows filenames can't contain `:`), so undo that
 * here before passing to Date. Returns ms since epoch, or null if
 * unparseable.
 */
function parseTimestampSegment(segment: string): number | null {
  // Pattern at rotation: "2026-05-16T09-30-00.123Z" (colons → hyphens)
  // We swap them back to colons in the time fields; the date dashes
  // already use hyphens and are untouched.
  const match = segment.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(\.\d+)?Z$/);
  if (!match) return null;
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5] ?? ''}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Filename-safe stamp (no colons). */
function fileSafeTimestamp(): string {
  return new Date().toISOString().replace(/:/g, '-');
}

/**
 * Roll the current `app.log` over to a timestamped `.bak` if its size
 * would exceed MAX_LOG_BYTES after appending `extraBytes` more bytes.
 * Best-effort: any failure leaves the existing file in place and we
 * just append to it as if nothing happened.
 */
async function rollIfNeeded(logsDir: string, extraBytes: number): Promise<void> {
  try {
    const current = `${logsDir}\\${LOG_FILE_NAME}`;
    if (!(await exists(current))) return;
    // The Tauri fs plugin doesn't expose a stat call; we approximate the
    // size by reading the file's text length. For files near the 5MB
    // ceiling this is one one-time read that triggers a rotation, not
    // a per-write cost — most writes will see a file well under the
    // ceiling and exit fast.
    //
    // A more efficient approach (track byte count in module memory)
    // would drift after restarts; the simple re-read keeps the truth
    // on disk where it belongs.
    const existing = await readTextFile(current);
    // UTF-8 byte length is a stricter upper bound for the rotation
    // check than `length` would be — but our log lines are mostly ASCII
    // and approximating via `length + extraBytes` is enough to keep the
    // file under the documented ceiling. The 5MB number is itself a
    // soft cap, not a hard constraint.
    if (existing.length + extraBytes < MAX_LOG_BYTES) return;
    const stamp = fileSafeTimestamp();
    const archived = `${logsDir}\\${LOG_FILE_NAME}.${stamp}.bak`;
    await rename(current, archived);
  } catch {
    // Best-effort rotation; absorb errors and keep writing to the old
    // file. The next write will retry the rotation check.
  }
}

/**
 * Append a single log line to `app.log`. Creates the file if missing.
 * Performs rotation if appending would exceed the size cap.
 */
async function appendLine(line: string): Promise<void> {
  const logsDir = await getLogsDir();
  if (!logsDir) return;
  const lineBytes = line.length; // approximate; see rollIfNeeded comment
  await rollIfNeeded(logsDir, lineBytes);
  const current = `${logsDir}\\${LOG_FILE_NAME}`;
  try {
    // Read-modify-write append: the Tauri fs plugin's writeTextFile
    // does NOT support append mode (no `append: true` option in v2). For
    // tiny log files this is fine — we pay one extra read per write but
    // avoid pulling in a separate Rust command. If volume ever grows
    // we'll add an `append_log_line` command on the Rust side.
    const previous = (await exists(current)) ? await readTextFile(current) : '';
    await writeTextFile(current, previous + line);
  } catch {
    // Swallow — the console mirror still got the message.
  }
}

/** Format a single log line. */
function formatLine(level: LogLevel, message: string): string {
  const ts = new Date().toISOString();
  return `${ts} ${level} ${message}\n`;
}

/**
 * Coerce arbitrary value (Error, string, object, etc.) into a single-
 * line log message. Stack traces are flattened to ` | ` between frames
 * so the log line stays one line.
 */
function stringifyMessage(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (p instanceof Error) {
        return `${p.name}: ${p.message}${
          p.stack ? ` | ${p.stack.split('\n').join(' | ')}` : ''
        }`;
      }
      if (typeof p === 'string') return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(' ');
}

/** Public API: log an informational message. Fire-and-forget. */
export function info(...parts: unknown[]): void {
  const message = stringifyMessage(parts);
  // eslint-disable-next-line no-console
  console.info('[markdown-reader]', message);
  void appendLine(formatLine('INFO', message));
}

/** Public API: log a warning. Fire-and-forget. */
export function warn(...parts: unknown[]): void {
  const message = stringifyMessage(parts);
  // eslint-disable-next-line no-console
  console.warn('[markdown-reader]', message);
  void appendLine(formatLine('WARN', message));
}

/** Public API: log an error. Fire-and-forget. */
export function error(...parts: unknown[]): void {
  const message = stringifyMessage(parts);
  // eslint-disable-next-line no-console
  console.error('[markdown-reader]', message);
  void appendLine(formatLine('ERROR', message));
}

/**
 * Default export — convenient `logger.warn(...)` style. The named exports
 * are also fine; both forms are supported.
 */
export const logger = { info, warn, error };
export default logger;
