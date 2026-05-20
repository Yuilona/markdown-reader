import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, {
  type ReactCodeMirrorRef,
  type ViewUpdate,
} from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import { useEditMode } from '../EditModeProvider/useEditMode';
import { useTheme } from '../ThemeProvider/useTheme';
import { getSettings } from '../../lib/settingsStore';
import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from '../../lib/settings';
import { themeExtension, settingsExtension } from './editorExtensions';
import { markdownActionsKeymap } from './markdownKeymap';
import styles from './CodeMirrorEditor.module.css';

/**
 * CodeMirror 6 wrapper (v1.0 PR-A skeleton, PR-B theming + tools).
 *
 * Imported via React.lazy at the call site (App.tsx), so CM6's chunk
 * arrives only when the user first switches to edit mode.
 *
 * Extensions on top of basicSetup:
 *   - `markdown()` — GFM syntax highlighting + the default
 *     `markdownKeymap` (smart list continuation, R-EDIT-1.7: Enter in
 *     `- item` inserts `- `; empty list line clears the marker).
 *   - `markdownActionsKeymap` — Ctrl+B/I/K/Shift+K tools (R-EDIT-7).
 *   - `themeExtension(effective)` — GitHub light/dark palette + token
 *     highlight. Reconfigures live on theme flip (R-EDIT-11), preserving
 *     cursor + scroll because the EditorState is untouched.
 *   - `settingsExtension(editor)` — soft-wrap + indent width from
 *     settings.editor (R-EDIT-12).
 *   - `EditorView.updateListener` — pushes cursor info to the StatusBar.
 *
 * Line numbers (R-EDIT-12 lineNumbers) are toggled through
 * @uiw/react-codemirror's `basicSetup` prop, which owns that gutter.
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
  const { effective } = useTheme();
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  // Editor sub-settings (lineWrap / lineNumbers / tabSize). Start from
  // the defaults so the first paint is correct, then promote to the
  // persisted values once settings.json resolves. The reconfigure is
  // cheap and only fires once per mount.
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(
    DEFAULT_EDITOR_SETTINGS,
  );
  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s) => {
      if (!cancelled) setEditorSettings(s.editor);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Push cursor info up to EditModeProvider on every selectionSet /
  // docChange. `line` is 1-indexed (CM6 native); `col` we +1 for
  // user-facing display.
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

  const extensions = useMemo<Extension[]>(
    () => [
      markdown(),
      markdownActionsKeymap,
      themeExtension(effective),
      settingsExtension(editorSettings),
      EditorView.updateListener.of(onUpdate),
    ],
    [effective, editorSettings, onUpdate],
  );

  // basicSetup overrides — only lineNumbers is settings-driven; the rest
  // keep their defaults (history, multi-cursor, search, brackets, fold).
  const basicSetup = useMemo(
    () => ({ lineNumbers: editorSettings.lineNumbers }),
    [editorSettings.lineNumbers],
  );

  // Clear the cursor when the editor unmounts (mode switch back to read)
  // so the StatusBar doesn't flash a stale line:col.
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
        basicSetup={basicSetup}
        // `theme="none"` is required: @uiw/react-codemirror defaults the
        // `theme` prop to 'light' and injects its OWN light EditorView.theme,
        // which would override our github light/dark palette from
        // `themeExtension(effective)` (the editor would stay light even
        // after a dark-mode toggle). With 'none', our extension is the
        // sole theme source and the dark flip takes effect.
        theme="none"
        height="100%"
        style={{ height: '100%' }}
      />
    </div>
  );
}

export default CodeMirrorEditor;
