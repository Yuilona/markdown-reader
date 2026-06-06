import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the persistence layer so scrollPositions.ts runs against in-memory
// JSON. `vi.hoisted` makes the mocks available inside the hoisted factory.
const { readJson, atomicWriteJson } = vi.hoisted(() => ({
  readJson: vi.fn(),
  atomicWriteJson: vi.fn().mockResolvedValue({ path: 'x' }),
}));
vi.mock('./persistJson', () => ({ readJson, atomicWriteJson }));
vi.mock('./logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  getScroll,
  saveScroll,
  flushScroll,
  clearScroll,
  resetScrollCacheForTests,
} from './scrollPositions';

/**
 * In-memory scroll-position cache tests (cr-performance #17).
 *
 * Verifies that `saveScroll` no longer writes on every call (it mutates
 * the in-memory array) and that `flushScroll` performs the deferred
 * atomic write — preserving the 100-entry LRU bound and get/clear
 * semantics.
 */
describe('scrollPositions in-memory cache (cr-performance #17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    atomicWriteJson.mockResolvedValue({ path: 'x' });
    readJson.mockResolvedValue(null); // start empty
    resetScrollCacheForTests();
  });

  it('saveScroll does NOT write to disk; flushScroll does', async () => {
    await saveScroll('C:\\docs\\a.md', 100);
    await saveScroll('C:\\docs\\a.md', 200);
    expect(atomicWriteJson).not.toHaveBeenCalled();

    await flushScroll();
    expect(atomicWriteJson).toHaveBeenCalledTimes(1);
    // The flushed payload reflects the LATEST in-memory value.
    const payload = atomicWriteJson.mock.calls[0][1] as {
      positions: { path: string; y: number }[];
    };
    expect(payload.positions[0].y).toBe(200);
  });

  it('flushScroll is a no-op when nothing changed since the last flush', async () => {
    await saveScroll('C:\\docs\\a.md', 10);
    await flushScroll();
    expect(atomicWriteJson).toHaveBeenCalledTimes(1);
    await flushScroll(); // dirty already cleared
    expect(atomicWriteJson).toHaveBeenCalledTimes(1);
  });

  it('reads disk only once, then serves getScroll from memory', async () => {
    readJson.mockResolvedValue({
      version: 1,
      positions: [{ path: 'C:\\docs\\a.md', y: 42, lastTouched: '2026-01-01T00:00:00.000Z' }],
    });
    expect(await getScroll('C:\\docs\\a.md')).toBe(42);
    expect(await getScroll('C:\\docs\\a.md')).toBe(42);
    // First access seeded the cache; the second served from memory.
    expect(readJson).toHaveBeenCalledTimes(1);
  });

  it('enforces the 100-entry LRU bound', async () => {
    for (let i = 0; i < 120; i++) {
      await saveScroll(`C:\\docs\\f${i}.md`, i);
    }
    await flushScroll();
    const payload = atomicWriteJson.mock.calls.at(-1)![1] as {
      positions: unknown[];
    };
    expect(payload.positions).toHaveLength(100);
  });

  it('clearScroll removes the entry and flushes immediately', async () => {
    await saveScroll('C:\\docs\\a.md', 5);
    await flushScroll();
    atomicWriteJson.mockClear();

    await clearScroll('C:\\docs\\a.md');
    expect(atomicWriteJson).toHaveBeenCalledTimes(1);
    expect(await getScroll('C:\\docs\\a.md')).toBeNull();
  });
});
