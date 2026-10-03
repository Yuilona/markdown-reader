import { describe, it, expect, vi, beforeEach } from 'vitest';

const { readSettings, writeSettings } = vi.hoisted(() => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
}));
vi.mock('./settings', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./settings')>();
  return { ...mod, readSettings, writeSettings };
});
vi.mock('./logger', () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));

import { DEFAULT_SETTINGS } from './settings';
import {
  invalidateSettingsCache,
  subscribeSettings,
  updateEditorSettings,
  updateSettings,
} from './settingsStore';

describe('settingsStore live updates (settings panel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSettingsCache();
    readSettings.mockResolvedValue(structuredClone(DEFAULT_SETTINGS));
    writeSettings.mockResolvedValue(undefined);
  });

  it('notifies subscribers with the merged settings, and stops after unsubscribe', async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeSettings((s) => seen.push(s.showTocByDefault));
    await updateSettings({ showTocByDefault: false });
    unsubscribe();
    await updateSettings({ showTocByDefault: true });
    expect(seen).toEqual([false]);
  });

  it('merges nested editor fields inside the queue, so back-to-back toggles both stick', async () => {
    // Fired without awaiting in between, like two quick clicks.
    void updateEditorSettings({ lineNumbers: true });
    const final = await updateEditorSettings({ tabSize: 4 });
    expect(final.editor).toMatchObject({ lineNumbers: true, tabSize: 4, lineWrap: true });
    expect(writeSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ editor: expect.objectContaining({ lineNumbers: true, tabSize: 4 }) }),
    );
  });
});
