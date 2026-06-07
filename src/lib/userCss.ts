import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { getDataDir } from './tauri';
import { joinUnder } from './pathUtils';
import * as logger from './logger';
// The bundled Claude "Quiet Serif" theme, inlined as a string at build time
// (Vite `?raw`). This is the single source of truth seeded into
// `data/user.css` on first run — see the seeding block below.
import claudeTheme from '../../theme/claude.user.css?raw';

/**
 * user.css loader + first-run theme seeding (R9.11 + R-THEME-bundle).
 *
 * On startup we read `<install_dir>/data/user.css` if it exists and inject
 * it as a `<style>` element appended LAST in `<head>`. Being last means it
 * wins specificity ties against the bundled `theme.light.css` /
 * `theme.dark.css` rules — the whole point of an opt-in override hook.
 *
 * First-run seeding:
 *   The bundled Claude theme is the out-of-box default. If `user.css` is
 *   ABSENT and the sentinel `data/.theme-seeded` is ALSO absent, we treat
 *   this as a never-seeded install: write the Claude theme to `user.css`,
 *   write the sentinel, then inject it this same session (no restart).
 *   The sentinel records "seeded once" so that deleting `user.css` later
 *   reverts to the plain default and is NOT resurrected on the next launch.
 *   An existing `user.css` (user-authored OR previously seeded) is never
 *   overwritten — the absent-check guards it.
 *
 *   Write order is user.css THEN sentinel: if we crash between the two, the
 *   theme file already exists so the next launch simply loads it (and skips
 *   seeding), rather than the sentinel-first failure mode where a missing
 *   user.css would be mistaken for a user deletion and never re-seeded.
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

export async function loadUserCss(): Promise<void> {
  try {
    const dir = await getDataDir();
    const path = joinUnder(dir, 'user.css');

    let css: string;
    if (await exists(path)) {
      // Existing user.css (authored or previously seeded) — load as-is,
      // never overwrite.
      css = await readTextFile(path);
    } else {
      const sentinel = joinUnder(dir, '.theme-seeded');
      if (await exists(sentinel)) {
        // Seeded once before, then deleted by the user → respect that
        // choice and fall back to the plain default theme.
        return;
      }
      // Never-seeded install: write the Claude theme + sentinel, then
      // inject it. user.css first so a crash between writes can't strand
      // us in the "looks like a user deletion" state.
      await writeTextFile(path, claudeTheme);
      await writeTextFile(sentinel, `seeded ${new Date().toISOString()}\n`);
      css = claudeTheme;
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
