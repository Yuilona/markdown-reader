import { exists, readTextFile } from '@tauri-apps/plugin-fs';

import { getDataDir } from './tauri';
import * as logger from './logger';

/**
 * user.css loader (R9.11).
 *
 * On startup, read `<install_dir>/data/user.css` if it exists and inject
 * it as a `<style>` element appended LAST in `<head>`. Being last means
 * it wins specificity ties against the bundled `theme.light.css` /
 * `theme.dark.css` rules — the whole point of an opt-in override hook.
 *
 * v0.1 behavior is intentionally minimal:
 *   - Loaded ONCE on app mount. No watcher; editing user.css requires
 *     restarting the app. Hot-reload is a v0.2 follow-up explicitly
 *     listed in PRD §"Out of Scope".
 *   - Missing file: no-op, no console warning. The user has opted IN
 *     by creating the file — its absence is the normal case.
 *   - Read failure (e.g. permission denied): log a warn and bail.
 *     A bad user.css must never break the app boot.
 *
 * Idempotency:
 *   The injected `<style>` carries a unique data-attribute so a
 *   double-call (StrictMode in dev) doesn't duplicate the rule set.
 */

const STYLE_TAG_ID = 'markdown-reader-user-css';

export async function loadUserCss(): Promise<void> {
  try {
    const dir = await getDataDir();
    const path = `${dir}\\user.css`;
    if (!(await exists(path))) {
      // Explicit opt-in feature — silent no-op when not present.
      return;
    }
    const css = await readTextFile(path);

    // Skip if a prior call already injected (React StrictMode double-
    // mounts effects in dev). The DOM-level dedup is cheaper than
    // smuggling a module-scope flag and survives a hot reload.
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
    // PR-8: console mirror + rolling log file. A failed user.css read
    // is unusual (file existed at the existence-check moment) so worth
    // surfacing in the durable log on top of the console.
    logger.warn('failed to load user.css:', err);
  }
}
