// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri + theme surfaces loadUserCss touches so the module runs in
// jsdom. `vi.hoisted` exposes the fns inside the hoisted vi.mock factories.
const { exists, readTextFile, writeTextFile, getDataDir } = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  getDataDir: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists, readTextFile, writeTextFile }));
vi.mock('./tauri', () => ({ getDataDir }));
vi.mock('./logger', () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
// The `?raw` import of the bundled theme → a fixed sentinel string.
vi.mock('../../theme/claude.user.css?raw', () => ({ default: 'CLAUDE_THEME_CSS' }));

import { loadUserCss } from './userCss';

const DATA_DIR = 'C:\\app\\data';
const USER_CSS = `${DATA_DIR}\\user.css`;
const SENTINEL = `${DATA_DIR}\\.theme-seeded`;
const STYLE_ID = 'markdown-reader-user-css';

function injected(): HTMLElement | null {
  return document.getElementById(STYLE_ID);
}

describe('loadUserCss — first-run seeding + load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataDir.mockResolvedValue(DATA_DIR);
    writeTextFile.mockResolvedValue(undefined);
    document.head.innerHTML = '';
  });

  it('loads an existing user.css as-is and never overwrites it', async () => {
    exists.mockImplementation(async (p: string) => p === USER_CSS);
    readTextFile.mockResolvedValue('.markdown-body{color:red}');

    await loadUserCss();

    expect(readTextFile).toHaveBeenCalledWith(USER_CSS);
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(injected()?.textContent).toBe('.markdown-body{color:red}');
  });

  it('seeds the Claude theme + sentinel on a never-seeded install, then injects it', async () => {
    // Neither user.css nor sentinel exist.
    exists.mockResolvedValue(false);

    await loadUserCss();

    // user.css written FIRST, sentinel SECOND.
    expect(writeTextFile).toHaveBeenCalledTimes(2);
    expect(writeTextFile.mock.calls[0][0]).toBe(USER_CSS);
    expect(writeTextFile.mock.calls[0][1]).toBe('CLAUDE_THEME_CSS');
    expect(writeTextFile.mock.calls[1][0]).toBe(SENTINEL);
    expect(writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(
      writeTextFile.mock.invocationCallOrder[1],
    );
    // The seeded theme is injected this same session.
    expect(injected()?.textContent).toBe('CLAUDE_THEME_CSS');
    // No read needed — we already hold the theme string.
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('does NOT re-seed when user.css is absent but the sentinel exists (user deleted it)', async () => {
    exists.mockImplementation(async (p: string) => p === SENTINEL);

    await loadUserCss();

    expect(writeTextFile).not.toHaveBeenCalled();
    expect(readTextFile).not.toHaveBeenCalled();
    expect(injected()).toBeNull();
  });

  it('is idempotent — a second call does not duplicate the injected <style>', async () => {
    exists.mockImplementation(async (p: string) => p === USER_CSS);
    readTextFile.mockResolvedValue('.x{}');

    await loadUserCss();
    await loadUserCss();

    expect(document.querySelectorAll(`#${STYLE_ID}`).length).toBe(1);
  });

  it('never throws on a write failure during seeding (boot must survive)', async () => {
    exists.mockResolvedValue(false);
    writeTextFile.mockRejectedValue(new Error('disk full'));

    await expect(loadUserCss()).resolves.toBeUndefined();
  });
});
