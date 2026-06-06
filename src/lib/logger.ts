import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
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
 *     `app.log.<isoTs>.bak` and a fresh file is started. The current size
 *     is tracked in a module-level byte counter (cr-performance #3),
 *     seeded ONCE at init from a single `stat`, so the rotation check no
 *     longer re-reads the whole file on every write.
 *   - Serialized writes: every append chains onto a single promise
 *     (`writeQueue`, mirroring `settingsStore.ts`) so concurrent
 *     fire-and-forget calls can't interleave their read-modify-write and
 *     lose lines (cr-performance #3).
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
 * Append strategy (cr-performance #3, approach B — JS-only, no Rust):
 *   The Tauri fs plugin's `writeTextFile` has no append mode, so we still
 *   do a read-modify-write per line. But the WRITES ARE SERIALIZED through
 *   a single promise chain and the rotation size is tracked in memory, so
 *   the old "2 full reads + 1 full write per line" (O(n)/line, ~O(n²)/
 *   session) collapses to "1 read + 1 write per line", strictly ordered.
 *   A native `append_log_line` command (approach A) would make this O(1)/
 *   line but is intentionally out of scope this round (no Rust changes).
 *
 * Atomic-write is NOT used here. Append is intentionally non-atomic —
 *   we accept the (vanishingly rare) risk of a half-written line if the
 *   app is killed mid-write.
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

// cr-performance #3: running byte count of the CURRENT `app.log`. Seeded
// ONCE during init from a single `stat` (or text read fallback) and then
// kept up to date as lines are appended — so `rollIfNeeded` no longer
// re-reads the whole file on every write. Reset to 0 on rotation.
let currentLogBytes = 0;

// cr-performance #3: serialized write tail. Every `appendLine` chains onto
// this promise (mirrors `settingsStore.ts` writeQueue) so concurrent
// fire-and-forget log calls can't interleave their read-modify-write and
// drop lines. A failure inside one link is swallowed below; we also reset
// the queue's rejection so a single failure never poisons later writes.
let writeQueue: Promise<void> = Promise.resolve();

/** UTF-8 byte length of a string. Log lines are mostly ASCII, but CJK
 *  messages cost up to 3 bytes/char — count properly so the rotation
 *  ceiling stays honest (cr-performance #3). */
function byteLength(s: string): number {
  // TextEncoder is available in the Tauri webview (and jsdom). Fall back
  // to `.length` if it's somehow missing.
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length;
}

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
    // cr-performance #3: seed the in-memory byte counter ONCE from the
    // existing log file's size (single stat). After this, appendLine keeps
    // the counter current so rollIfNeeded never re-reads the file.
    currentLogBytes = await readCurrentLogBytes(logsDir);
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

/**
 * Read the current `app.log` size in bytes (cr-performance #3). Prefers a
 * single `stat` (O(1), no file read); falls back to reading the text and
 * measuring its UTF-8 length if `stat` is unavailable or fails. Returns 0
 * when the file doesn't exist yet. Best-effort — any error yields 0.
 */
async function readCurrentLogBytes(logsDir: string): Promise<number> {
  const current = `${logsDir}\\${LOG_FILE_NAME}`;
  try {
    if (!(await exists(current))) return 0;
    try {
      const info = await stat(current);
      if (typeof info.size === 'number' && Number.isFinite(info.size)) {
        return info.size;
      }
    } catch {
      // stat unsupported / failed — fall through to the text-read path.
    }
    const existing = await readTextFile(current);
    return byteLength(existing);
  } catch {
    return 0;
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
 *
 * cr-performance #3: uses the in-memory `currentLogBytes` counter (seeded
 * once at init) instead of re-reading the whole file every write. On a
 * successful rotation the counter resets to 0.
 */
async function rollIfNeeded(logsDir: string, extraBytes: number): Promise<void> {
  if (currentLogBytes + extraBytes < MAX_LOG_BYTES) return;
  try {
    const current = `${logsDir}\\${LOG_FILE_NAME}`;
    if (!(await exists(current))) {
      // No file on disk — counter was stale; reset and skip the rename.
      currentLogBytes = 0;
      return;
    }
    const stamp = fileSafeTimestamp();
    const archived = `${logsDir}\\${LOG_FILE_NAME}.${stamp}.bak`;
    await rename(current, archived);
    // The fresh file starts empty.
    currentLogBytes = 0;
  } catch {
    // Best-effort rotation; absorb errors and keep writing to the old
    // file. The next write will retry the rotation check.
  }
}

/**
 * Append a single log line to `app.log`. Creates the file if missing.
 * Performs rotation if appending would exceed the size cap.
 *
 * cr-performance #3: SERIALIZED through `writeQueue` so concurrent
 * fire-and-forget calls can't interleave their read-modify-write and lose
 * lines. The in-memory byte counter is advanced only after a successful
 * write so a failed write doesn't drift the rotation accounting.
 */
function appendLine(line: string): Promise<void> {
  // Chain onto the serialized tail. Each link does the full
  // roll-check → read-modify-write, strictly after the previous link.
  const task = writeQueue.then(async () => {
    const logsDir = await getLogsDir();
    if (!logsDir) return;
    const lineBytes = byteLength(line);
    await rollIfNeeded(logsDir, lineBytes);
    const current = `${logsDir}\\${LOG_FILE_NAME}`;
    try {
      // Read-modify-write append: the Tauri fs plugin's writeTextFile
      // does NOT support append mode (no `append: true` option in v2). We
      // pay one read per write (down from the previous two) but avoid a
      // separate Rust command (cr-performance #3, approach B). Because the
      // queue serializes us, no other appendLine can read a stale `previous`
      // between our read and our write.
      const previous = (await exists(current)) ? await readTextFile(current) : '';
      await writeTextFile(current, previous + line);
      // Advance the in-memory size counter only on a successful write.
      currentLogBytes += lineBytes;
    } catch {
      // Swallow — the console mirror still got the message.
    }
  });
  // Never let one failed link reject the shared tail (which would skip all
  // queued writes after it). Mirrors settingsStore.ts's belt-and-suspenders.
  writeQueue = task.catch(() => {});
  return writeQueue;
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
