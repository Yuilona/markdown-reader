import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/**
 * Flash-highlight a single editor line (v1.0, bidirectional line sync).
 *
 * Used when the user clicks a block in the preview: we move the editor
 * cursor to the corresponding source line AND briefly highlight it so the
 * eye can find it. Implemented as a line Decoration toggled by a
 * StateEffect; the highlight is cleared after a short timeout by the
 * caller dispatching `setFlashLine.of(null)`.
 */

/** Effect carrying the 1-indexed line to flash, or null to clear. */
export const setFlashLine = StateEffect.define<number | null>();

const flashDeco = Decoration.line({ class: 'cm-flashLine' });

const flashLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFlashLine)) {
        if (e.value === null) {
          next = Decoration.none;
        } else {
          const lineNum = Math.max(1, Math.min(e.value, tr.state.doc.lines));
          const line = tr.state.doc.line(lineNum);
          next = Decoration.set([flashDeco.range(line.from)]);
        }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Editor extension: install the flash-line decoration field. */
export const flashLineExtension = flashLineField;

/**
 * Move the cursor to `lineNum` (1-indexed, clamped), center it, focus the
 * editor, and flash-highlight the line for ~900ms.
 */
export function flashEditorLine(view: EditorView, lineNum: number): void {
  const total = view.state.doc.lines;
  const ln = Math.max(1, Math.min(lineNum, total));
  const line = view.state.doc.line(ln);
  view.dispatch({
    selection: { anchor: line.from },
    effects: [setFlashLine.of(ln), EditorView.scrollIntoView(line.from, { y: 'center' })],
  });
  view.focus();
  window.setTimeout(() => {
    // The view may have been torn down (mode switch) before the timeout.
    try {
      view.dispatch({ effects: setFlashLine.of(null) });
    } catch {
      // editor unmounted — nothing to clear.
    }
  }, 900);
}
