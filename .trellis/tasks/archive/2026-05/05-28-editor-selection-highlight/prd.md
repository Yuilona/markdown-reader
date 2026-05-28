# Fix CodeMirror Mouse Selection Highlight

## Problem

Mouse-drag selection in the edit page did not reliably show the app/theme highlight color. Previous attempts targeted normal browser selection or low-specificity CodeMirror selectors, so CodeMirror's own focused selection styles continued to win.

## Root Cause

`@uiw/react-codemirror` `basicSetup` enables CodeMirror 6 `drawSelection()`. That extension hides native browser selection and paints the selected range through overlay DOM:

```css
.cm-selectionLayer .cm-selectionBackground
```

CodeMirror's base theme also defines focused light/dark selectors with higher specificity than the old app rule:

```css
&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
&dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
```

The old selector `&.cm-focused .cm-selectionBackground` was too weak, and it reused `--bg-active`, which is not a text-selection token and has weak contrast in some themes.

## Acceptance Criteria

- Mouse selection in the editor is painted by the app/theme selection color in both light and dark modes.
- The override targets CodeMirror's `drawSelection()` overlay, not only native `::selection`.
- The selector beats CodeMirror's focused base-theme rule without `!important`.
- Default and Claude user themes expose a dedicated `--cm-selection-bg` token.
- Type-check, tests, and production build pass.

## Verification

- `pnpm exec tsc --noEmit`
- `pnpm test`
- `pnpm build`

