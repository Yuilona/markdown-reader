import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { getDataDir } from './tauri';
import { joinUnder } from './pathUtils';
import * as logger from './logger';
import { LEGACY_THEME_FINGERPRINTS, themeFingerprint } from './themeFingerprint';
// The bundled Claude "Quiet Serif" theme, inlined as a string at build time
// (Vite `?raw`). This is the single source of truth seeded into
// `data/user.css` on first run — see the seeding block below.
import claudeTheme from '../../theme/claude.user.css?raw';

/**
 * user.css loader + bundled-theme seeding / auto-upgrade (R9.11 +
 * R-THEME-bundle).
 *
 * On startup we read `<install_dir>/data/user.css` if it exists and inject
 * it as a `<style>` element appended LAST in `<head>`. Being last means it
 * wins specificity ties against the bundled `theme.light.css` /
 * `theme.dark.css` rules — the whole point of an opt-in override hook.
 *
 * What to do is decided by the pure `planUserCss` (see there):
 *   - never seeded           → write the bundled Claude theme (out-of-box
 *                              default) + the `.theme-seeded` sentinel.
 *   - seeded, then deleted   → respect the deletion; plain default theme.
 *   - untouched OLD theme    → replace with the current bundled theme.
 *   - anything else          → the user's own CSS; load it, never write it.
 *
 * Why auto-upgrade: user.css used to be written once and never touched, so
 * every theme fix shipped after an install (bundled fonts, dark code-block
 * band, alert colors…) never reached it. A copy that is byte-identical to a
 * theme we shipped has no user edits to lose, so upgrading it is safe; a
 * single edited character opts the file out for good.
 *
 * Sentinel format: `seeded <iso>` + `fingerprint <hex>` (the fingerprint of
 * the theme we last wrote). Pre-v1.4.7 sentinels have no fingerprint line —
 * those installs are matched against `LEGACY_THEME_FINGERPRINTS` instead.
 *
 * Write order is user.css THEN sentinel: if we crash between the two, the
 * theme file already holds the current theme, so the next launch sees it as
 * up to date (and a fresh install doesn't mistake a missing user.css for a
 * user deletion).
 *
 * Other behavior (unchanged from v0.1):
 *   - Loaded ONCE on app mount. No watcher; editing user.css requires a
 *     restart. Hot-reload remains out of scope.
 *   - Read/write failure: log a warn and bail. A bad user.css (or a failed
 *     seed) must never break the app boot.
 *
 * Idempotency:
 *   The injected `<style>` carries a unique data-attribute so a double-call
 *   (StrictMode in dev) doesn't duplicate the rule set.
 */

const STYLE_TAG_ID = 'markdown-reader-user-css';

export type UserCssPlan =
  /** Write the bundled theme (+ sentinel), then inject it. */
  | { kind: 'seed' }
  /** user.css is an untouched older bundled theme: overwrite + inject. */
  | { kind: 'upgrade' }
  /** Inject the existing user.css as-is (current theme or user-authored). */
  | { kind: 'load' }
  /** Seeded once, then deleted by the user: inject nothing. */
  | { kind: 'none' };

/** Fingerprint recorded in the sentinel, or null (absent / pre-v1.4.7). */
function sentinelFingerprint(sentinel: string | null): string | null {
  const m = sentinel?.match(/^fingerprint\s+([0-9a-f]+)\s*$/m);
  return m ? m[1] : null;
}

/** Decide what to do with user.css. Pure — all I/O stays in loadUserCss. */
export function planUserCss(input: {
  /** Contents of user.css, or null when the file doesn't exist. */
  userCss: string | null;
  /** Contents of `.theme-seeded`, or null when it doesn't exist. */
  sentinel: string | null;
  /** The theme bundled with this build. */
  bundled: string;
}): UserCssPlan {
  const { userCss, sentinel, bundled } = input;
  if (userCss === null) return sentinel === null ? { kind: 'seed' } : { kind: 'none' };

  const current = themeFingerprint(userCss);
  if (current === themeFingerprint(bundled)) return { kind: 'load' };
  const untouchedShippedTheme =
    current === sentinelFingerprint(sentinel) || LEGACY_THEME_FINGERPRINTS.has(current);
  return untouchedShippedTheme ? { kind: 'upgrade' } : { kind: 'load' };
}

export async function loadUserCss(): Promise<void> {
  try {
    const dir = await getDataDir();
    const path = joinUnder(dir, 'user.css');
    const sentinelPath = joinUnder(dir, '.theme-seeded');

    const userCss = (await exists(path)) ? await readTextFile(path) : null;
    const sentinel = (await exists(sentinelPath)) ? await readTextFile(sentinelPath) : null;
    const plan = planUserCss({ userCss, sentinel, bundled: claudeTheme });

    let css: string;
    switch (plan.kind) {
      case 'none':
        return;
      case 'load':
        css = userCss ?? '';
        break;
      case 'seed':
      case 'upgrade':
        await writeTextFile(path, claudeTheme);
        await writeTextFile(
          sentinelPath,
          `seeded ${new Date().toISOString()}\nfingerprint ${themeFingerprint(claudeTheme)}\n`,
        );
        if (plan.kind === 'upgrade') {
          logger.info('upgraded untouched bundled theme in user.css to the current version');
        }
        css = claudeTheme;
        break;
    }

    // Skip if a prior call already injected (React StrictMode double-mounts
    // effects in dev). The DOM-level dedup is cheaper than a module-scope
    // flag and survives a hot reload.
    if (document.getElementById(STYLE_TAG_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    // Appending to <head> places this rule set after every imported
    // stylesheet, so it wins specificity ties without `!important`.
    style.textContent = css;
    document.head.appendChild(style);
  } catch (err) {
    // A failed user.css read or first-run seed is unusual but must never
    // break boot — surface it in the durable log on top of the console.
    logger.warn('failed to load/seed user.css:', err);
  }
}
