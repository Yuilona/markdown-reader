import { atomicWriteJson, readJson } from './persistJson';

/**
 * Settings store (R10.2).
 *
 * Layout: `<install_dir>/data/settings.json`
 * Schema:
 *   {
 *     "version": 1,
 *     "theme": "light" | "dark" | "system",
 *     "pageZoom": 100,            // 50..200, step 10 (R10.5)
 *     "showTocByDefault": true
 *   }
 *
 * Semantics:
 *   - Same atomic-write + corrupt-recovery pattern as `recent.json` and
 *     `scroll-positions.json` (uses `persistJson.ts`).
 *   - Corrupt / missing JSON: silently returns DEFAULT_SETTINGS (R10.8).
 *   - The v0.1 GUI surface is intentionally tiny (theme toggle in
 *     Titlebar + Ctrl+T); other fields are stored for the v0.2 GUI
 *     settings panel to consume.
 *
 * Why "version" is a literal `1` and not a `number`:
 *   - Keeps the door open for v0.2 migrations: a future reader can
 *     branch on `parsed.version !== 1` and run a migrator before the
 *     validation pass below. Until then, the literal type pins the
 *     shape so a stray field can't be smuggled in via TS.
 */

const FILE_NAME = 'settings.json';
const SCHEMA_VERSION = 1 as const;

export type ThemeMode = 'light' | 'dark' | 'system';

export interface Settings {
  version: typeof SCHEMA_VERSION;
  /** R10.2 theme preference. Default is 'system' (R9.1 fallback). */
  theme: ThemeMode;
  /** R10.5 page-level zoom percent. 50..200, step 10. v0.1 persists but
   *  the wiring of Ctrl+= / Ctrl+- / Ctrl+0 ships in PR-8. */
  pageZoom: number;
  /** R10.2: whether the TOC sidebar is open by default. The actual TOC
   *  UI ships in PR-7; this field is the durable default it reads. */
  showTocByDefault: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SCHEMA_VERSION,
  theme: 'system',
  pageZoom: 100,
  showTocByDefault: true,
};

/** Coerce arbitrary parsed JSON back to a valid Settings object. Any
 *  field that fails the shape check is replaced by the default — we
 *  never throw past this boundary so a corrupt settings.json never
 *  crashes the app (R10.8). */
function validate(parsed: unknown): Settings {
  if (!parsed || typeof parsed !== 'object') {
    return { ...DEFAULT_SETTINGS };
  }
  const obj = parsed as Partial<Settings>;
  const theme: ThemeMode =
    obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system'
      ? obj.theme
      : DEFAULT_SETTINGS.theme;

  // Clamp + snap pageZoom into the valid range.
  let pageZoom = DEFAULT_SETTINGS.pageZoom;
  if (typeof obj.pageZoom === 'number' && Number.isFinite(obj.pageZoom)) {
    pageZoom = Math.max(50, Math.min(200, Math.round(obj.pageZoom)));
  }

  const showTocByDefault =
    typeof obj.showTocByDefault === 'boolean'
      ? obj.showTocByDefault
      : DEFAULT_SETTINGS.showTocByDefault;

  return {
    version: SCHEMA_VERSION,
    theme,
    pageZoom,
    showTocByDefault,
  };
}

/** Read settings.json from disk. Returns DEFAULT_SETTINGS if missing or
 *  corrupt. */
export async function readSettings(): Promise<Settings> {
  const raw = await readJson<unknown>(FILE_NAME);
  if (raw === null) {
    return { ...DEFAULT_SETTINGS };
  }
  return validate(raw);
}

/** Atomic-write the current settings. Errors are surfaced to the caller
 *  so a write failure can be logged at the call site (parity with the
 *  recent.json / scroll-positions.json contracts). */
export async function writeSettings(settings: Settings): Promise<void> {
  await atomicWriteJson<Settings>(FILE_NAME, settings);
}
