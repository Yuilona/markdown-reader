import { useCallback, useEffect, useMemo, useRef } from 'react';
import CodeMirror, {
  EditorView,
  type ReactCodeMirrorRef,
  type ViewUpdate,
} from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';

import { useEditMode } from '../EditModeProvider/useEditMode';
import styles from './CodeMirrorEditor.module.css';

/**
 * CodeMirror 6 wrapper (v1.0 PR-A, R-EDIT-1).
 *
 * Imported via React.lazy at the call site (App.tsx), so CM6's ~200KB
 * gzip arrives only when the user first switches to edit mode. The
 * default export below is the actual component; the wrapper file
 * re-exports a lazy() wrapper.
 *
 * Why we use `@uiw/react-codemirror`:
 *   - Provides a React-friendly `<CodeMirror>` with `value`/`onChange`
 *     props. Internally it reuses a single EditorView across renders
 *     (diffs the doc + dispatches a transaction), so typing latency
 *     is O(1) per keystroke regardless of React re-render storms.
 *   - basicSetup default extensions cover multi-cursor, search,
 *     bracket-matching, history (undo/redo), and line numbers (which
 *     PR-A keeps on for editor familiarity — the lineNumbers settings
 *     toggle is read by PR-B).
 *
 * Extensions we add on top of basicSetup:
 *   - `markdown()` from @codemirror/lang-markdown — GFM-flavored
 *     syntax highlighting (headings, bold/italic, code fences, task
 *     lists, tables). The package also ships a `markdownKeymap` which
 *     implements smart list continuation (Enter in `- item` inserts
 *     another `- `; empty list item exits the list). We bind it via
 *     `keymap.of(markdownKeymap)` so R-EDIT-1.7 works out of the box.
 *   - `EditorView.lineWrapping` — soft-wrap long paragraphs (markdown
 *     is prose; horizontal scroll is a worse UX than wrap). PR-B
 *     surfaces this as a settings toggle.
 *   - `EditorView.updateListener.of(...)` — pushes cursor + selection
 *     info up to EditModeProvider so StatusBar can render `行:列`.
 *
 * Theme: PR-A uses the plain default light theme. PR-B adds GitHub
 * light/dark theming + remount-on-effective-flip with cursor preserved.
 *
 * Wide-character handling: CM6 uses UTF-16 code unit positions
 * internally, which matches JavaScript's String semantics — we don't
 * need any special handling for CJK or emoji. Cursor info `line/col`
 * is 1-indexed (CM6 reports 1-indexed lines via `state.doc.lineAt`,
 * which is what users expect from editor status bars).
 */
export interface CodeMirrorEditorProps {
  /** Current text the editor displays. Owner is EditModeProvider's
   *  bufferText state. */
  value: string;
  /** Called with the new text on every keystroke / paste / undo. */
  onChange: (next: string) => void;
}

function CodeMirrorEditor({ value, onChange }: CodeMirrorEditorProps) {
  const { setCursor } = useEditMode();
  // Ref to the React wrapper so we COULD imperatively focus / get the
  // EditorView for future PR-B work (Ctrl+B/I/K markdown actions). Not
  // used for any side-effect in PR-A.
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  // Push cursor info up to EditModeProvider on every selectionSet.
  // We read from `update.state.selection.main.head` which is the
  // primary cursor's absolute offset, then translate to line+col via
  // `state.doc.lineAt(head)`. CM6's line numbers are already 1-indexed
  // for `doc.lineAt(...).number`. Column is 0-indexed in CM6 internals
  // so we +1 for user-facing display.
  const onUpdate = useCallback(
    (update: ViewUpdate) => {
      if (!update.selectionSet && !update.docChanged) return;
      const { state } = update;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      setCursor({ line: line.number, col: head - line.from + 1 });
    },
    [setCursor],
  );

  // Extensions list — memoized so the EditorView's plugin reconfiguration
  // only fires on actual extension changes (not parent re-renders).
  //
  // `markdown({ addKeymap: true })` is the default — it auto-installs
  // `markdownKeymap` which binds Enter to `insertNewlineContinueMarkup`
  // (R-EDIT-1.7 smart list continuation: pressing Enter inside
  // `- item` inserts another `- `; empty list line clears the marker).
  // We don't add a second keymap layer for it.
  const extensions = useMemo<Extension[]>(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.updateListener.of(onUpdate),
    ],
    [onUpdate],
  );

  // Clear the cursor when the editor unmounts (mode switch back to read).
  // Otherwise the StatusBar would briefly flash a stale line:col before
  // EditModeProvider's setMode handler clears it.
  useEffect(() => {
    return () => {
      setCursor(null);
    };
  }, [setCursor]);

  return (
    <div className={styles.editor}>
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="light"
        height="100%"
        style={{ height: '100%' }}
        // basicSetup is the default — it provides line numbers, history,
        // multi-cursor, search (Mod-f), brackets, fold gutter, etc.
        // PR-B will surface granular toggles via settings.editor.*.
      />
    </div>
  );
}

export default CodeMirrorEditor;
