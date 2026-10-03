import { describe, it, expect } from 'vitest';

import { validateWindowState } from './windowState';

describe('validateWindowState', () => {
  const normal = { version: 1, x: 300, y: 200, width: 1000, height: 700, maximized: false };

  it('accepts a normal floating window', () => {
    expect(validateWindowState(normal)).toEqual(normal);
  });

  it('accepts negative coordinates from a monitor left of the primary', () => {
    expect(validateWindowState({ ...normal, x: -1920, y: -11 })).not.toBeNull();
  });

  it('rejects a minimized-window snapshot (-32000 sentinel, tiny size)', () => {
    // Exactly what v1.4.4 wrote after minimizing on Windows.
    expect(
      validateWindowState({ version: 1, x: -32000, y: -32000, width: 144, height: 19, maximized: false }),
    ).toBeNull();
  });

  it('rejects the -32000 sentinel position even with a sane size', () => {
    expect(validateWindowState({ ...normal, x: -32000, y: -32000 })).toBeNull();
  });

  it('rejects a size too small to be a usable window', () => {
    expect(validateWindowState({ ...normal, width: 160, height: 28 })).toBeNull();
    expect(validateWindowState({ ...normal, width: 1000, height: 50 })).toBeNull();
  });

  it('rejects missing or non-numeric fields', () => {
    expect(validateWindowState({ ...normal, width: undefined })).toBeNull();
    expect(validateWindowState({ ...normal, maximized: 'yes' })).toBeNull();
    expect(validateWindowState(null)).toBeNull();
  });
});
