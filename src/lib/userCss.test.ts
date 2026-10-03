// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri + theme surfaces loadUserCss touches so the module runs in
// jsdom. `vi.hoisted` exposes the fns inside the hoisted vi.mock factories.
const { exists, readTextFile, writeTextFile, remove, getDataDir } = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  remove: vi.fn(),
  getDataDir: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists, readTextFile, writeTextFile, remove }));
vi.mock('./tauri', () => ({ getDataDir }));
vi.mock('./logger', () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
// The `?raw` import of the bundled theme → a fixed sentinel string.
vi.mock('../../theme/claude.user.css?raw', () => ({ default: 'CLAUDE_THEME_CSS' }));
// A stand-in "theme shipped before sentinels carried fingerprints". The real
// table holds fingerprints of historical theme/claude.user.css versions.
vi.mock('./themeFingerprint', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./themeFingerprint')>();
  return { ...mod, LEGACY_THEME_FINGERPRINTS: new Set([mod.themeFingerprint('LEGACY_THEME_CSS')]) };
});

import {
  disableUserCss,
  getUserCssStatus,
  loadUserCss,
  planUserCss,
  restoreBundledTheme,
} from './userCss';
import { themeFingerprint } from './themeFingerprint';

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
    // Only the sentinel is read (for its fingerprint) — never a user.css.
    expect(readTextFile).not.toHaveBeenCalledWith(USER_CSS);
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

describe('planUserCss — bundled theme auto-upgrade', () => {
  const bundled = 'CLAUDE_THEME_CSS';
  const sentinelFor = (css: string) =>
    `seeded 2026-10-04T00:00:00.000Z\nfingerprint ${themeFingerprint(css)}\n`;

  it('seeds a never-seeded install and respects a deletion', () => {
    expect(planUserCss({ userCss: null, sentinel: null, bundled }).kind).toBe('seed');
    expect(planUserCss({ userCss: null, sentinel: 'seeded x\n', bundled }).kind).toBe('none');
  });

  it('loads a user.css that already is the current theme (CRLF or not) without rewriting', () => {
    expect(planUserCss({ userCss: bundled, sentinel: sentinelFor(bundled), bundled }).kind).toBe('load');
    expect(planUserCss({ userCss: 'a\r\nb\r\n', sentinel: null, bundled: 'a\nb' }).kind).toBe('load');
  });

  it('upgrades the untouched theme recorded in the sentinel', () => {
    expect(
      planUserCss({ userCss: 'OLD_THEME', sentinel: sentinelFor('OLD_THEME'), bundled }).kind,
    ).toBe('upgrade');
  });

  it('upgrades an untouched legacy theme (old sentinel without fingerprint, or no sentinel)', () => {
    expect(
      planUserCss({ userCss: 'LEGACY_THEME_CSS', sentinel: 'seeded 2026-05-25\n', bundled }).kind,
    ).toBe('upgrade');
    expect(planUserCss({ userCss: 'LEGACY_THEME_CSS', sentinel: null, bundled }).kind).toBe('upgrade');
  });

  it('never touches a user-edited theme', () => {
    expect(
      planUserCss({ userCss: 'OLD_THEME /* mine */', sentinel: sentinelFor('OLD_THEME'), bundled }).kind,
    ).toBe('load');
    expect(planUserCss({ userCss: 'LEGACY_THEME_CSS .x{}', sentinel: null, bundled }).kind).toBe('load');
  });
});

describe('loadUserCss — upgrade path I/O', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataDir.mockResolvedValue(DATA_DIR);
    writeTextFile.mockResolvedValue(undefined);
    document.head.innerHTML = '';
  });

  it('replaces an untouched old theme, records the new fingerprint, injects the new theme', async () => {
    exists.mockResolvedValue(true);
    readTextFile.mockImplementation(async (p: string) =>
      p === USER_CSS ? 'OLD_THEME' : `seeded x\nfingerprint ${themeFingerprint('OLD_THEME')}\n`,
    );

    await loadUserCss();

    expect(writeTextFile.mock.calls[0]).toEqual([USER_CSS, 'CLAUDE_THEME_CSS']);
    expect(writeTextFile.mock.calls[1][0]).toBe(SENTINEL);
    expect(writeTextFile.mock.calls[1][1]).toContain(
      `fingerprint ${themeFingerprint('CLAUDE_THEME_CSS')}`,
    );
    expect(injected()?.textContent).toBe('CLAUDE_THEME_CSS');
  });

  it('seeding writes a fingerprint so later theme releases can upgrade it', async () => {
    exists.mockResolvedValue(false);

    await loadUserCss();

    expect(writeTextFile.mock.calls[1][1]).toMatch(/^seeded .+\nfingerprint [0-9a-f]{14}\n$/);
  });
});

describe('settings panel theme actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDataDir.mockResolvedValue(DATA_DIR);
    writeTextFile.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
    document.head.innerHTML = '';
  });

  it('reports bundled / custom / none', async () => {
    exists.mockResolvedValue(false);
    expect(await getUserCssStatus()).toBe('none');
    exists.mockResolvedValue(true);
    readTextFile.mockResolvedValue('CLAUDE_THEME_CSS\r\n');
    expect(await getUserCssStatus()).toBe('bundled');
    readTextFile.mockResolvedValue('.mine{}');
    expect(await getUserCssStatus()).toBe('custom');
  });

  it('restoreBundledTheme writes theme + fingerprint and applies it live', async () => {
    document.head.innerHTML = `<style id="${STYLE_ID}">.old{}</style>`;
    await restoreBundledTheme();
    expect(writeTextFile.mock.calls[0]).toEqual([USER_CSS, 'CLAUDE_THEME_CSS']);
    expect(writeTextFile.mock.calls[1][0]).toBe(SENTINEL);
    expect(injected()?.textContent).toBe('CLAUDE_THEME_CSS');
  });

  it('disableUserCss deletes user.css, keeps it from re-seeding, and removes the live style', async () => {
    document.head.innerHTML = `<style id="${STYLE_ID}">.x{}</style>`;
    exists.mockImplementation(async (p: string) => p === USER_CSS); // no sentinel yet
    await disableUserCss();
    expect(remove).toHaveBeenCalledWith(USER_CSS);
    expect(writeTextFile.mock.calls[0][0]).toBe(SENTINEL);
    expect(injected()).toBeNull();
  });
});
