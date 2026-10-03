import { describe, it, expect, vi, beforeEach } from 'vitest';

const { initialize, clearCacheForTheme } = vi.hoisted(() => ({
  initialize: vi.fn(),
  clearCacheForTheme: vi.fn(),
}));
vi.mock('mermaid', () => ({ default: { initialize } }));
vi.mock('./mermaidCache', () => ({ clearCacheForTheme }));

// Fresh module state (the loaded promise + theme vars are module-scoped).
async function freshModule() {
  vi.resetModules();
  return import('./mermaidLazy');
}

const lastInitTheme = () => initialize.mock.calls.at(-1)?.[0].theme;

describe('mermaidLazy theme switching', () => {
  beforeEach(() => {
    initialize.mockClear();
    clearCacheForTheme.mockClear();
  });

  it('latest request wins when an earlier one is still awaiting the load (startup race)', async () => {
    const m = await freshModule();
    void m.loadMermaid();
    // OS-derived theme first, persisted setting a moment later.
    const first = m.setMermaidTheme('dark');
    const second = m.setMermaidTheme('default');
    await Promise.all([first, second]);
    expect(m.getMermaidTheme()).toBe('default');
    expect(lastInitTheme()).toBe('default');
  });

  it('does not load Mermaid just to record a theme', async () => {
    const m = await freshModule();
    await m.setMermaidTheme('dark');
    expect(initialize).not.toHaveBeenCalled();
    await m.loadMermaid();
    expect(lastInitTheme()).toBe('dark');
    expect(m.getMermaidTheme()).toBe('dark');
  });

  it('re-initializes and drops the old theme cache on a real switch', async () => {
    const m = await freshModule();
    await m.loadMermaid();
    await m.setMermaidTheme('dark');
    expect(lastInitTheme()).toBe('dark');
    expect(clearCacheForTheme).toHaveBeenCalledWith('default');
    initialize.mockClear();
    await m.setMermaidTheme('dark');
    expect(initialize).not.toHaveBeenCalled();
  });
});
