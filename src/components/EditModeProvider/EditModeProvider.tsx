import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { saveDocument, type LoadedDocument } from '../../lib/tauri';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { getSettings } from '../../lib/settingsStore';
import { useToast } from '../Toast/useToast';

/**
 * Edit-mode provider (v1.0 PR-A, R-EDIT-3 / R-EDIT-5).
 *
 * Owns the "is the user in read or edit mode" state plus the editor
 * buffer (the in-memory text the user is currently editing, which may
 * have diverged from the on-disk file).
 *
 * The boundary contract:
 *   - The parent (App.tsx) owns `doc: LoadedDocument | null` — the
 *     last loaded file. It hands us `doc` plus `onDocTextSync(text)`
 *     so we can tell it "the buffer is now the on-disk truth" after a
 *     successful save (which the parent uses to refresh its
 *     LoadedDocument so the next render's doc.text matches what we
 *     just wrote).
 *   - We own `bufferText` (the live editor content) and `mode`.
 *   - On `doc` change (open new file / watcher reload), we reset
 *     `bufferText` to `doc.text` AND clear the dirty bit. This is
 *     intentional: if a watcher reload happens while we're not dirty,
 *     the file's on-disk version is the source of truth and the
 *     editor should reflect it. If we ARE dirty when a reload comes,
 *     the conflict-toast in useFileWatcher (R-EDIT-8) prevents the
 *     parent from calling its onReload at all, so doc.text doesn't
 *     actually swap — this reset path doesn't fire.
 *
 * mode defaults: read from `settings.editor.defaultMode` (default
 * 'read'). Per-session toggles do NOT persist — only the explicit
 * future "default mode" setting does. This matches R-EDIT-3.5.
 *
 * Save flow:
 *   - `save()` writes bufferText to disk via `saveDocument` and on
 *     success calls onDocTextSync(bufferText). The parent then
 *     produces a new LoadedDocument { path, text: bufferText } and
 *     re-feeds us via the `doc` prop on the next render — at which
 *     point our doc-text-changed effect resets buffer to the same
 *     text and dirty becomes false naturally.
 *   - Toast on success uses `silent` to suppress the green "已保存"
 *     for the mode-switch silent-save path (R-EDIT-5.2). Errors
 *     always show a red toast (R-EDIT-5.1 negative branch).
 *
 * The `dirty` state is DERIVED (`bufferText !== doc.text`), not stored
 * — this means we don't need to remember to clear it when the doc
 * swaps; the derivation handles it. The only cost is a string-eq
 * compare on every render of consumers, but bufferText is typically
 * <100KB and string-eq is fast.
 */

/** Cursor info surfaced to the StatusBar (R-EDIT-2.6). 1-indexed for
 *  human display — `line` matches what the user sees in the editor
 *  gutter or in Markdown source-line callouts. */
export interface CursorInfo {
  line: number;
  col: number;
}

export interface EditModeContextValue {
  /** Current display mode. */
  mode: 'read' | 'edit';
  /** Switch modes. From 'edit' → 'read' with dirty buffer, silently
   *  auto-saves first (R-EDIT-3.4, R-EDIT-5.2). */
  setMode: (mode: 'read' | 'edit') => Promise<void>;
  /** Convenience: flip the current mode. Same semantics as setMode. */
  toggleMode: () => Promise<void>;
  /** Live editor text. Mirrors doc.text in read mode (unedited). */
  bufferText: string;
  /** Editor onChange writes here. Called on every keystroke (CM6
   *  already debounces internally). */
  setBufferText: (text: string) => void;
  /** True when bufferText has diverged from doc.text. */
  dirty: boolean;
  /** Explicit save (Ctrl+S). Toast on success unless `silent` is true.
   *  Throws on FS failure; the caller (useShortcuts) catches + logs +
   *  surfaces an error toast. */
  save: (options?: { silent?: boolean }) => Promise<void>;
  /** Cursor info for StatusBar. CM6 calls `setCursor(...)` on every
   *  selectionSet event. `null` when not in edit mode. */
  cursor: CursorInfo | null;
  /** Setter for the editor to push its cursor state up. */
  setCursor: (cursor: CursorInfo | null) => void;
  /** Approximate word count of the current buffer. PR-A: simple
   *  whitespace split. Recomputed on every bufferText change — cheap
   *  enough for typical doc sizes (well under 1ms for a 100KB doc). */
  wordCount: number;
}

const EditModeContext = createContext<EditModeContextValue | null>(null);
export { EditModeContext };

interface EditModeProviderProps {
  /** The currently-loaded document. `null` when on EmptyState. */
  doc: LoadedDocument | null;
  /** Called after a successful save with the just-written text. The
   *  parent uses this to refresh its LoadedDocument so doc.text
   *  matches what's on disk. */
  onDocTextSync: (text: string) => void;
  children: ReactNode;
}

/** Cheap word count: split on whitespace runs and count non-empty
 *  tokens. For Chinese (no spaces) this is a poor approximation, but
 *  no existing v0.1 string utility handles CJK either — we'll revisit
 *  with a proper grapheme-aware counter in PR-B if users complain.
 *  Result is monotonically clamped to >= 0 so an empty buffer reports
 *  0 (split on empty string yields a single empty token). */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function EditModeProvider({
  doc,
  onDocTextSync,
  children,
}: EditModeProviderProps) {
  const toast = useToast();

  // PR-A: mode defaults to read (or settings.editor.defaultMode once
  // settings.json resolves). Per-session toggles do NOT persist
  // (R-EDIT-3.5).
  const [mode, setModeState] = useState<'read' | 'edit'>(
    DEFAULT_SETTINGS.editor.defaultMode,
  );
  const [bufferText, setBufferTextState] = useState<string>(doc?.text ?? '');
  const [cursor, setCursorState] = useState<CursorInfo | null>(null);

  // Track the last doc.text we observed so we can detect a change
  // (vs a redundant re-render). We compare on every render — cheap
  // because string-eq is O(1) for interned literals and our doc.text
  // is a fresh string each LoadedDocument, so referential inequality
  // is the fast path.
  const lastDocTextRef = useRef<string | null>(null);
  const lastDocPathRef = useRef<string | null>(null);
  // Tracks the text we most recently wrote to disk via save(). When
  // the parent's onDocTextSync(text) fires back as a doc.text change,
  // we recognize it as our own write and DO NOT reset the buffer —
  // crucial for the "user typed more during the save's await" race:
  // without this, the user's post-save typing would be silently
  // clobbered when our own write echoes back as a doc.text change.
  const justWroteTextRef = useRef<string | null>(null);

  // Load persisted defaultMode on mount. We promote the in-memory
  // mode to the persisted default IF the user hasn't already
  // interacted (i.e. we're still on the DEFAULT_SETTINGS sentinel).
  // After any user toggle the settings load is a no-op for `mode`.
  const userTouchedModeRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSettings();
      if (cancelled || userTouchedModeRef.current) return;
      setModeState(s.editor.defaultMode);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset buffer when doc.path OR doc.text changes (open new file,
  // close current file, watcher silent reload). The path comparison
  // catches "switched to a different file"; the text comparison
  // catches "same file, content changed externally".
  //
  // SELF-WRITE RACE GUARD:
  //   When save() finishes it calls onDocTextSync(textToWrite), which
  //   propagates back as a new doc.text. If the user kept typing
  //   during the save's await, bufferText has DIVERGED from
  //   textToWrite — we must NOT clobber that divergence. So when the
  //   new doc.text matches our `justWroteTextRef`, we acknowledge it
  //   (update lastDocTextRef so a future external change still
  //   triggers a reset) but leave bufferTextState alone.
  useEffect(() => {
    const currentText = doc?.text ?? '';
    const currentPath = doc?.path ?? null;
    const pathChanged = lastDocPathRef.current !== currentPath;
    const textChanged = lastDocTextRef.current !== currentText;
    if (pathChanged || textChanged) {
      lastDocTextRef.current = currentText;
      lastDocPathRef.current = currentPath;
      // Self-write echo? Skip the buffer reset.
      if (
        !pathChanged &&
        justWroteTextRef.current !== null &&
        justWroteTextRef.current === currentText
      ) {
        // Consumed — clear the marker so a subsequent external write
        // with the same text doesn't ALSO get treated as self-write.
        justWroteTextRef.current = null;
        return;
      }
      // External / open / close → adopt the new on-disk truth.
      justWroteTextRef.current = null;
      setBufferTextState(currentText);
    }
  }, [doc?.path, doc?.text]);

  // Derived dirty state. The base case (no doc) is "never dirty" —
  // there's nothing to save to.
  const dirty = useMemo(() => {
    if (!doc) return false;
    return bufferText !== doc.text;
  }, [doc, bufferText]);

  const wordCount = useMemo(() => countWords(bufferText), [bufferText]);

  // Save: write bufferText to disk via tauri.saveDocument. On success,
  // sync the parent's LoadedDocument so doc.text === bufferText (which
  // clears `dirty`). On failure, surface an error toast and rethrow so
  // the Ctrl+S handler can log it.
  //
  // `silent: true` is used by the mode-switch auto-save path
  // (R-EDIT-5.2) so the user doesn't get a "已保存" toast every time
  // they toggle back to read mode.
  const save = useCallback(
    async (options: { silent?: boolean } = {}): Promise<void> => {
      if (!doc) {
        // PR-A: no doc, no save target. PR-B will handle the
        // unsaved-new-buffer case with a Save As dialog.
        return;
      }
      const textToWrite = bufferText;
      try {
        await saveDocument(doc.path, textToWrite);
        // Mark this text as our self-write so the parent's resulting
        // doc.text change doesn't clobber any post-save typing the
        // user did during the await above. See the reset effect's
        // SELF-WRITE RACE GUARD comment.
        justWroteTextRef.current = textToWrite;
        // Tell the parent: the new on-disk truth is `textToWrite`.
        onDocTextSync(textToWrite);
        if (!options.silent) {
          toast.show('已保存', { variant: 'success' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.show('保存失败', { variant: 'error', details: message });
        // Bubble so the caller knows the save didn't take. Used by the
        // mode-switch flow to NOT switch back to read mode when the
        // silent-save failed (otherwise the dirty buffer would silently
        // vanish from view).
        throw err;
      }
    },
    [doc, bufferText, onDocTextSync, toast],
  );

  // setMode with the dirty-aware silent-save logic for edit→read
  // (R-EDIT-3.4 / R-EDIT-5.2). edit→edit and read→read are no-ops
  // (cheap to detect; avoids any re-renders).
  const setMode = useCallback(
    async (next: 'read' | 'edit'): Promise<void> => {
      userTouchedModeRef.current = true;
      if (next === mode) return;
      if (mode === 'edit' && next === 'read' && dirty && doc) {
        try {
          await save({ silent: true });
        } catch {
          // Save failed — abort the mode flip so the user can see + retry.
          // The save() call already showed an error toast.
          return;
        }
      }
      // Reset cursor when leaving edit mode — the StatusBar reads
      // `cursor` to decide whether to show the "line:col" cell.
      if (next === 'read') {
        setCursorState(null);
      }
      setModeState(next);
    },
    [mode, dirty, doc, save],
  );

  const toggleMode = useCallback(async (): Promise<void> => {
    await setMode(mode === 'edit' ? 'read' : 'edit');
  }, [mode, setMode]);

  // bufferText setter — wrapped in useCallback so CodeMirrorEditor's
  // onChange prop has stable identity (otherwise the EditorView
  // remount cost would dominate typing latency).
  const setBufferText = useCallback((text: string) => {
    setBufferTextState(text);
  }, []);

  const setCursor = useCallback((next: CursorInfo | null) => {
    setCursorState(next);
  }, []);

  const value = useMemo<EditModeContextValue>(
    () => ({
      mode,
      setMode,
      toggleMode,
      bufferText,
      setBufferText,
      dirty,
      save,
      cursor,
      setCursor,
      wordCount,
    }),
    [
      mode,
      setMode,
      toggleMode,
      bufferText,
      setBufferText,
      dirty,
      save,
      cursor,
      setCursor,
      wordCount,
    ],
  );

  return (
    <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>
  );
}

