import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every Tauri surface tauri.ts (and its import graph) touches, so the
// module loads in plain node and we can assert the atomic-write sequence.
// `vi.hoisted` makes the mock fns available inside the hoisted vi.mock
// factory (vi.mock is lifted above these declarations otherwise).
const { writeTextFile, rename, remove, readTextFile, exists } = vi.hoisted(() => ({
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  readTextFile: vi.fn(),
  exists: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile, rename, remove, readTextFile, exists }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue('C:\\app\\data') }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('./logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { saveDocument } from './tauri';

describe('saveDocument atomic write (v1.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a sibling .tmp first, then renames it over the target', async () => {
    writeTextFile.mockResolvedValue(undefined);
    rename.mockResolvedValue(undefined);

    await saveDocument('C:\\docs\\note.md', 'hello world');

    expect(writeTextFile).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);

    const tmpArg = writeTextFile.mock.calls[0][0] as string;
    const content = writeTextFile.mock.calls[0][1] as string;
    const [renameFrom, renameTo] = rename.mock.calls[0] as [string, string];

    expect(tmpArg).toMatch(/\.tmp$/);
    expect(content).toBe('hello world');
    expect(renameFrom).toBe(tmpArg);
    expect(renameTo).toBe(tmpArg.replace(/\.tmp$/, ''));
    // tmp write happens BEFORE the rename.
    expect(writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(
      rename.mock.invocationCallOrder[0],
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('never renames over the original when the tmp write fails, and removes the tmp', async () => {
    writeTextFile.mockRejectedValue(new Error('disk full'));
    remove.mockResolvedValue(undefined);

    await expect(saveDocument('C:\\docs\\note.md', 'data')).rejects.toThrow('disk full');

    // The original file is never touched because rename only runs after a
    // complete tmp write.
    expect(rename).not.toHaveBeenCalled();
    // Orphaned tmp is cleaned up.
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toMatch(/\.tmp$/);
  });

  it('propagates a rename failure (and tries to clean the tmp)', async () => {
    writeTextFile.mockResolvedValue(undefined);
    rename.mockRejectedValue(new Error('rename denied'));
    remove.mockResolvedValue(undefined);

    await expect(saveDocument('C:\\docs\\note.md', 'data')).rejects.toThrow('rename denied');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
