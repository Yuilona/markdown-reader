import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the persistence layer so readSettings is exercised against
// in-memory JSON instead of disk / Tauri APIs. `vi.hoisted` makes the
// mock fns available inside the hoisted vi.mock factory.
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

import { readSettings, DEFAULT_EDITOR_SETTINGS } from './settings';

describe('settings migration (R-EDIT-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    atomicWriteJson.mockResolvedValue({ path: 'x' });
  });

  it('fills editor + splitRatio defaults for a v0.1 settings file', async () => {
    readJson.mockResolvedValue({
      version: 1,
      theme: 'dark',
      pageZoom: 120,
      showTocByDefault: false,
    });
    const s = await readSettings();
    // Preserved fields
    expect(s.theme).toBe('dark');
    expect(s.pageZoom).toBe(120);
    expect(s.showTocByDefault).toBe(false);
    // Migrated-in defaults
    expect(s.splitRatio).toBe(0.5);
    expect(s.editor).toEqual(DEFAULT_EDITOR_SETTINGS);
  });

  it('writes the migrated shape back to disk when fields were missing', async () => {
    readJson.mockResolvedValue({ version: 1, theme: 'light', pageZoom: 100, showTocByDefault: true });
    await readSettings();
    expect(atomicWriteJson).toHaveBeenCalledTimes(1);
  });

  it('clamps out-of-range pageZoom + splitRatio', async () => {
    readJson.mockResolvedValue({ version: 1, pageZoom: 9999, splitRatio: 5, editor: {} });
    const s = await readSettings();
    expect(s.pageZoom).toBe(200);
    expect(s.splitRatio).toBe(0.8);
  });

  it('clamps editor.tabSize and coerces bad editor fields', async () => {
    readJson.mockResolvedValue({
      version: 1,
      splitRatio: 0.4,
      editor: { defaultMode: 'edit', tabSize: 99, scrollSync: 'nope' },
    });
    const s = await readSettings();
    expect(s.editor.defaultMode).toBe('edit');
    expect(s.editor.tabSize).toBe(8); // clamped to max
    expect(s.editor.scrollSync).toBe(true); // non-boolean → default
  });

  it('returns full defaults for a missing settings file', async () => {
    readJson.mockResolvedValue(null);
    const s = await readSettings();
    expect(s.editor.defaultMode).toBe('read');
    expect(s.splitRatio).toBe(0.5);
    // Missing file is NOT a migration → no write-back.
    expect(atomicWriteJson).not.toHaveBeenCalled();
  });
});
