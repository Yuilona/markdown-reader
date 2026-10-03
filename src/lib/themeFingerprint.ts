/**
 * Content fingerprint for the bundled theme, used by `userCss.ts` to tell an
 * untouched copy of a shipped theme (safe to upgrade) from a user-edited
 * `user.css` (never touched).
 *
 * Normalized first so the same theme text always matches: the seeded copy
 * was whatever `?raw` inlined at build time, which carries CRLF on a Windows
 * checkout (core.autocrlf) and LF elsewhere.
 *
 * cyrb53 (53-bit, non-cryptographic): we only need "is this byte-identical
 * to a theme we shipped", not tamper resistance — and unlike
 * `crypto.subtle` it is synchronous and works in any context.
 */
export function themeFingerprint(css: string): string {
  const text = css.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trimEnd();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * Fingerprints of every `theme/claude.user.css` version shipped BEFORE the
 * sentinel started recording the seeded fingerprint (v1.4.7). Installs from
 * that era have only `seeded <date>` in `.theme-seeded` — or, for copies
 * placed by hand before auto-seeding existed, no sentinel at all — so this
 * frozen table is how we recognize their untouched copies.
 *
 * FROZEN: future theme edits need NO entry here; installs seeded or
 * upgraded from v1.4.7 on carry their fingerprint in the sentinel.
 *
 * Generated from `git log -- theme/claude.user.css` (oldest → newest):
 */
export const LEGACY_THEME_FINGERPRINTS: ReadonlySet<string> = new Set<string>([
  '079ce9736e2def', // aa79934 2026-05-25 bundle Claude (Quiet Serif) theme
  '090b18d56df4fe', // bc012e3 2026-05-25 quieter warm-taupe scrollbar
  '085451358bf182', // e7c9761 2026-05-25 wide tables overflowed right edge
  '18a121829a5e9a', // 346f36f 2026-05-25 bundle OSS fonts + first-run auto-apply
  '08a5158294d6a6', // e7c7cbc 2026-05-25 wide-table layout + reading width
  '121839540d2842', // 71766ca 2026-05-28 visible text selection
  '182a7d21f0918f', // 126004d 2026-10-04 dark code-block band fix (v1.4.6)
]);
