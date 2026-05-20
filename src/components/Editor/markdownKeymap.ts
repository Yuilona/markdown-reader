import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView, type Command } from '@codemirror/view';

/**
 * Markdown tool keymap (v1.0 PR-B, R-EDIT-7).
 *
 *   - Ctrl+B  → wrap selection in `**...**` (R-EDIT-7.1)
 *   - Ctrl+I  → wrap selection in `*...*`   (R-EDIT-7.2)
 *   - Ctrl+K  → insert a `[text](url)` link (R-EDIT-7.3)
 *   - Ctrl+Shift+K → insert an `![alt](src)` image (R-EDIT-7.4)
 *
 * Link/image insertion: instead of the PRD's modal-input flow, we use a
 * CM6-native placeholder-selection: the inserted snippet has its `url`
 * (or `text`/`alt`) placeholder pre-selected so the user just keeps
 * typing to fill it in. This avoids a focus-stealing modal mid-edit and
 * keeps the whole interaction inside the editor — smoother, and it
 * composes with multi-cursor (every cursor gets its own link skeleton).
 *
 * All commands operate over the full selection set via `changeByRange`,
 * so multi-cursor bold/italic/link work out of the box (R-EDIT-1.5).
 */

/** Wrap each selection range with `mark` on both sides. Empty ranges
 *  insert the marks and drop the cursor between them so the user can
 *  type the emphasized text immediately. */
function wrapWith(view: EditorView, mark: string): boolean {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to);
      const insert = `${mark}${selected}${mark}`;
      const innerStart = range.from + mark.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range:
          selected.length === 0
            ? EditorSelection.cursor(innerStart)
            : EditorSelection.range(innerStart, innerStart + selected.length),
      };
    }),
  );
  view.focus();
  return true;
}

/** Insert a link (or image) skeleton. With a selection, the selected
 *  text becomes the label and the `url` placeholder is pre-selected.
 *  Without a selection, the label placeholder (`text`/`alt`) is
 *  pre-selected first. */
function insertLink(view: EditorView, image: boolean): boolean {
  const { state } = view;
  const prefix = image ? '![' : '[';
  const labelPlaceholder = image ? 'alt' : 'text';
  view.dispatch(
    state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to);
      if (selected.length > 0) {
        const insert = `${prefix}${selected}](url)`;
        // Offset of `url` = prefix + label + "](" (2 chars).
        const urlStart = range.from + prefix.length + selected.length + 2;
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.range(urlStart, urlStart + 'url'.length),
        };
      }
      const insert = `${prefix}${labelPlaceholder}](url)`;
      const labelStart = range.from + prefix.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(labelStart, labelStart + labelPlaceholder.length),
      };
    }),
  );
  view.focus();
  return true;
}

const boldCommand: Command = (view) => wrapWith(view, '**');
const italicCommand: Command = (view) => wrapWith(view, '*');
const linkCommand: Command = (view) => insertLink(view, false);
const imageCommand: Command = (view) => insertLink(view, true);

/** High-precedence so these win over any default editor binding for the
 *  same chord (none collide today, but Prec.high future-proofs against a
 *  basicSetup change). */
export const markdownActionsKeymap: Extension = Prec.high(
  keymap.of([
    { key: 'Mod-b', run: boldCommand, preventDefault: true },
    { key: 'Mod-i', run: italicCommand, preventDefault: true },
    { key: 'Mod-k', run: linkCommand, preventDefault: true },
    { key: 'Mod-Shift-k', run: imageCommand, preventDefault: true },
  ]),
);
