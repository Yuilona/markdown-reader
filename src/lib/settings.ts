import { atomicWriteJson, readJson } from './persistJson';

/**
 * Settings store (R10.2).
 *
 * Layout: `<install_dir>/data/settings.json`
 * Schema (v1.0):
 *   {
 *     "version": 1,
 *     "theme": "light" | "dark" | "system",
 *     "pageZoom": 100,              // 50..200, step 10 (R10.5)
 *     "showTocByDefault": true,
 *     "splitRatio": 0.5,            // v1.0 (R-EDIT-2.3): 0.2..0.8
 *     "editor": {                   // v1.0 (R-EDIT-12)
 *       "defaultMode": "read" | "edit",
 *       "autoSave": false,
 *       "scrollSync": true,
 *       "lineNumbers": false,
 *       "lineWrap": true,
 *       "tabSize": 2
 *     }
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
 * v1.0 migration (R-EDIT-12):
 *   - A settings.json from v0.1 lacks `splitRatio` and `editor`.
 *     `validate()` merges defaults in transparently and `readSettings`
 *     writes the migrated shape back to disk on the next save —
 *     callers don't need to know whether a migration happened.
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

/** v1.0 (R-EDIT-3.5, R-EDIT-12). */
export type EditorDefaultMode = 'read' | 'edit';

/** v1.0 editor sub-settings (R-EDIT-12). */
export interface EditorSettings {
  /** Mode the app boots into on launch. Persisted; per-session toggles
   *  do NOT write this back (only an explicit user preference change
   *  via the future GUI settings panel does). */
  defaultMode: EditorDefaultMode;
  /** Background auto-save toggle. PR-A: always false; PR-B may surface
   *  in the GUI panel. v1.0 ships with this off — Ctrl+S + the
   *  silent-save-on-mode-switch are the only save paths. */
  autoSave: boolean;
  /** Bidirectional scroll sync between editor + preview. PR-A: read
   *  but not used (no sync yet); PR-B turns it on. */
  scrollSync: boolean;
  /** Show line numbers in CM6 gutter. PR-A: read but defaults to false
   *  to keep the editor visually clean for casual edits. */
  lineNumbers: boolean;
  /** Soft-wrap long lines instead of horizontal scroll. PR-A: read +
   *  applied (PR-A always enables wrap, this is the persisted default
   *  for the future settings UI). */
  lineWrap: boolean;
  /** Tab character width in spaces (display only — CM6 default is
   *  hard tabs unless overridden). PR-A: read but not yet used. */
  tabSize: number;
}

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
  /** v1.0 (R-EDIT-2.3): split-view editor/preview ratio. Range 0.2..0.8.
   *  PR-A: read but pinned at 0.5 (drag splitter ships in PR-B). */
  splitRatio: number;
  /** v1.0 (R-EDIT-12): editor sub-object. See EditorSettings for fields. */
  editor: EditorSettings;
}

/** Default editor sub-settings (R-EDIT-12). Pulled out so `validate()`
 *  can fill missing nested fields without cloning the whole tree. */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  defaultMode: 'read',
  autoSave: false,
  scrollSync: true,
  lineNumbers: false,
  lineWrap: true,
  tabSize: 2,
};

export const DEFAULT_SETTINGS: Settings = {
  version: SCHEMA_VERSION,
  theme: 'system',
  pageZoom: 100,
  showTocByDefault: true,
  splitRatio: 0.5,
  editor: { ...DEFAULT_EDITOR_SETTINGS },
};

/** Validate + clamp the editor sub-object. Any missing or invalid field
 *  is replaced by the default — same contract as the top-level
 *  `validate()`. */
function validateEditor(raw: unknown): EditorSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EDITOR_SETTINGS };
  }
  const obj = raw as Partial<EditorSettings>;
  const defaultMode: EditorDefaultMode =
    obj.defaultMode === 'read' || obj.defaultMode === 'edit'
      ? obj.defaultMode
      : DEFAULT_EDITOR_SETTINGS.defaultMode;
  const autoSave =
    typeof obj.autoSave === 'boolean' ? obj.autoSave : DEFAULT_EDITOR_SETTINGS.autoSave;
  const scrollSync =
    typeof obj.scrollSync === 'boolean' ? obj.scrollSync : DEFAULT_EDITOR_SETTINGS.scrollSync;
  const lineNumbers =
    typeof obj.lineNumbers === 'boolean'
      ? obj.lineNumbers
      : DEFAULT_EDITOR_SETTINGS.lineNumbers;
  const lineWrap =
    typeof obj.lineWrap === 'boolean' ? obj.lineWrap : DEFAULT_EDITOR_SETTINGS.lineWrap;
  let tabSize = DEFAULT_EDITOR_SETTINGS.tabSize;
  if (typeof obj.tabSize === 'number' && Number.isFinite(obj.tabSize)) {
    // Reasonable bound — 1..8 covers every realistic editor convention.
    tabSize = Math.max(1, Math.min(8, Math.round(obj.tabSize)));
  }
  return { defaultMode, autoSave, scrollSync, lineNumbers, lineWrap, tabSize };
}

/** Coerce arbitrary parsed JSON back to a valid Settings object. Any
 *  field that fails the shape check is replaced by the default — we
 *  never throw past this boundary so a corrupt settings.json never
 *  crashes the app (R10.8). */
function validate(parsed: unknown): Settings {
  if (!parsed || typeof parsed !== 'object') {
    return {
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_EDITOR_SETTINGS },
    };
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

  // v1.0 (R-EDIT-2.3): clamp splitRatio to the documented 0.2..0.8 band.
  // A persisted value outside the range is suspicious (the only legit
  // path that writes splitRatio is the PR-B drag splitter, which is
  // already clamped on write) — coerce to the default instead of trying
  // to preserve garbage.
  let splitRatio = DEFAULT_SETTINGS.splitRatio;
  if (typeof obj.splitRatio === 'number' && Number.isFinite(obj.splitRatio)) {
    splitRatio = Math.max(0.2, Math.min(0.8, obj.splitRatio));
  }

  // v1.0 (R-EDIT-12): editor sub-object — defaulted whole-object if
  // missing, field-defaulted per-field otherwise.
  const editor = validateEditor(obj.editor);

  return {
    version: SCHEMA_VERSION,
    theme,
    pageZoom,
    showTocByDefault,
    splitRatio,
    editor,
  };
}

/** Detect a pre-v1.0 settings file (missing splitRatio OR editor). When
 *  true, callers know to write the validated/migrated result back to
 *  disk so the on-disk file reflects the new schema on next launch. */
function needsMigration(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Partial<Settings>;
  if (typeof obj.splitRatio !== 'number') return true;
  if (!obj.editor || typeof obj.editor !== 'object') return true;
  return false;
}

/** Read settings.json from disk. Returns DEFAULT_SETTINGS if missing or
 *  corrupt.
 *
 *  v1.0 migration (R-EDIT-12): when the parsed file lacks `splitRatio`
 *  / `editor`, validate() merges defaults in AND we kick off a
 *  fire-and-forget write-back so the on-disk file is migrated. The
 *  write-back is fire-and-forget because (a) `readSettings` is
 *  synchronous-shaped from the caller's POV (returns the validated
 *  Settings immediately) and (b) a write failure during migration is
 *  harmless — the in-memory settings are correct, and the next launch
 *  will see the still-pre-v1.0 file and re-migrate. */
export async function readSettings(): Promise<Settings> {
  const raw = await readJson<unknown>(FILE_NAME);
  if (raw === null) {
    return {
      ...DEFAULT_SETTINGS,
      editor: { ...DEFAULT_EDITOR_SETTINGS },
    };
  }
  const validated = validate(raw);
  if (needsMigration(raw)) {
    // Fire-and-forget — failures are silently dropped (the next launch
    // will retry). We DELIBERATELY don't await: callers want their
    // Settings now, not after a potentially slow disk write.
    void writeSettings(validated).catch(() => undefined);
  }
  return validated;
}

/** Atomic-write the current settings. Errors are surfaced to the caller
 *  so a write failure can be logged at the call site (parity with the
 *  recent.json / scroll-positions.json contracts). */
export async function writeSettings(settings: Settings): Promise<void> {
  await atomicWriteJson<Settings>(FILE_NAME, settings);
}
