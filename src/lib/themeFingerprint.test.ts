import { describe, it, expect } from 'vitest';

import { LEGACY_THEME_FINGERPRINTS, themeFingerprint } from './themeFingerprint';

describe('themeFingerprint', () => {
  it('is frozen — known answers (LEGACY_THEME_FINGERPRINTS depends on this exact algorithm)', () => {
    // If this fails, the hash changed and every legacy entry is now dead:
    // untouched old themes would silently stop auto-upgrading. Don't
    // "improve" the function; add a new one instead.
    expect(themeFingerprint('')).toBe('0bdcb81aee8d83');
    expect(themeFingerprint('.markdown-body { color: red; }')).toBe('055bf73e687774');
  });

  it('ignores line-ending style, a BOM and trailing whitespace', () => {
    const lf = 'a {\n  color: red;\n}';
    expect(themeFingerprint('a {\r\n  color: red;\r\n}\r\n')).toBe(themeFingerprint(lf));
    expect(themeFingerprint(`﻿${lf}\n\n`)).toBe(themeFingerprint(lf));
  });

  it('changes on any real edit', () => {
    expect(themeFingerprint('a{color:red}')).not.toBe(themeFingerprint('a{color:blue}'));
  });

  it('legacy table holds well-formed fingerprints', () => {
    expect(LEGACY_THEME_FINGERPRINTS.size).toBe(7);
    for (const fp of LEGACY_THEME_FINGERPRINTS) expect(fp).toMatch(/^[0-9a-f]{14}$/);
  });
});
