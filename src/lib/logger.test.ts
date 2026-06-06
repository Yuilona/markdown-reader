import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri fs surface + getDataDir so logger.ts runs in plain node.
// `vi.hoisted` makes the mock fns available inside the hoisted vi.mock
// factory (vi.mock is lifted above these declarations otherwise).
const { exists, mkdir, readDir, readTextFile, remove, rename, stat, writeTextFile, getDataDir } =
  vi.hoisted(() => ({
    exists: vi.fn(),
    mkdir: vi.fn(),
    readDir: vi.fn(),
    readTextFile: vi.fn(),
    remove: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    writeTextFile: vi.fn(),
    getDataDir: vi.fn(),
  }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  stat,
  writeTextFile,
}));
vi.mock('./tauri', () => ({ getDataDir }));

/**
 * logger write-queue + in-memory byte-counter tests (cr-performance #3,
 * approach B — JS-only, no Rust command).
 *
 * We re-import the module fresh per test (`vi.resetModules`) so the
 * module-level `currentLogBytes` / `writeQueue` / `initPromise` start clean.
 */
async function freshLogger() {
  vi.resetModules();
  return import('./logger');
}

describe('logger serialized writes (cr-performance #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataDir.mockResolvedValue('C:\\app\\data');
    mkdir.mockResolvedValue(undefined);
    readDir.mockResolvedValue([]);
    rename.mockResolvedValue(undefined);
    // logs dir + log file both "exist".
    exists.mockResolvedValue(true);
    // Seed size from stat (single stat, no full read).
    stat.mockResolvedValue({ size: 0 });
  });

  it('serializes concurrent appends so no full-file overwrite is lost', async () => {
    const logger = await freshLogger();

    // Model the file on disk: every write must read what the PREVIOUS
    // write left. If two writes interleaved (read stale → overwrite), a
    // line would vanish — that's exactly what serialization prevents.
    let fileContents = '';
    readTextFile.mockImplementation(async () => fileContents);
    writeTextFile.mockImplementation(async (_path: string, data: string) => {
      // Simulate I/O latency so an unserialized impl would interleave.
      await new Promise((r) => setTimeout(r, 1));
      fileContents = data;
    });

    // Fire three log calls "concurrently" (fire-and-forget public API).
    logger.info('one');
    logger.warn('two');
    logger.error('three');

    // Drain the write queue: the LAST appendLine's returned promise is the
    // tail, but the public API is void — wait a tick for all to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(fileContents).toContain('one');
    expect(fileContents).toContain('two');
    expect(fileContents).toContain('three');
    // Three distinct lines survived (no clobbering).
    const lines = fileContents.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it('seeds the byte counter from stat once and rotates at the size cap', async () => {
    const logger = await freshLogger();

    // Pretend the existing log is already ~5MB so the very next write
    // triggers rotation (rename to .bak), driven by the in-memory counter
    // seeded from stat — NOT a fresh full-file read.
    stat.mockResolvedValue({ size: 5 * 1024 * 1024 });
    let fileContents = '';
    readTextFile.mockImplementation(async () => fileContents);
    writeTextFile.mockImplementation(async (_path: string, data: string) => {
      fileContents = data;
    });

    logger.info('after rotation');
    await new Promise((r) => setTimeout(r, 50));

    // Rotation happened: the old file was renamed to a .bak.
    expect(rename).toHaveBeenCalledTimes(1);
    const archived = rename.mock.calls[0][1] as string;
    expect(archived).toMatch(/app\.log\..*\.bak$/);
    // stat was used to seed the size (single stat), not a per-write read.
    expect(stat).toHaveBeenCalled();
  });

  it('does not re-read the whole file on every write for size accounting', async () => {
    const logger = await freshLogger();

    let fileContents = '';
    readTextFile.mockImplementation(async () => fileContents);
    writeTextFile.mockImplementation(async (_path: string, data: string) => {
      fileContents = data;
    });

    logger.info('a');
    logger.info('b');
    logger.info('c');
    await new Promise((r) => setTimeout(r, 50));

    // Old impl did 2 reads/write (rollIfNeeded re-read + append re-read).
    // New impl reads at most once per write (the append read-modify-write),
    // so total reads <= number of writes. Three writes → at most 3 reads.
    expect(readTextFile.mock.calls.length).toBeLessThanOrEqual(3);
    expect(writeTextFile).toHaveBeenCalledTimes(3);
  });
});
