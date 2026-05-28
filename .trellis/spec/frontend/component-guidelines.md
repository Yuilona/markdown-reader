# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

### CodeMirror Selection Styling

**What**: Editor selection colors must be defined through the CodeMirror theme extension in `src/components/Editor/editorExtensions.ts` and theme tokens in `src/styles/theme.light.css`, `src/styles/theme.dark.css`, and user themes.

**Why**: `@uiw/react-codemirror` `basicSetup` enables CodeMirror 6 `drawSelection()`. That hides the browser's native selection and renders selected text with overlay DOM:

```css
.cm-selectionLayer .cm-selectionBackground
```

Styling only `.cm-content ::selection` is not enough for mouse selection in the editor.

**Required selector shape**: The focused override must beat CodeMirror's built-in light/dark base-theme selectors:

```css
&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
&dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
```

Use the higher-specificity focused selector in the local `EditorView.theme(...)`:

```typescript
'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground.cm-selectionBackground': {
  background: 'var(--cm-selection-bg)',
}
```

The duplicated `.cm-selectionBackground` is intentional. It increases specificity without `!important`, so local theme colors win regardless of stylesheet insertion order.

**Token**: Use `--cm-selection-bg` for editor text selection. Do not reuse generic surface tokens such as `--bg-active`; those are usually too low-contrast and are not semantically tied to text selection.

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

### Common Mistake: Styling CodeMirror Selection as Native Browser Selection

**Symptom**: Dragging with the mouse in the edit page creates a real selection, but the highlight is invisible or uses CodeMirror's default gray/purple color instead of the app theme.

**Cause**: CodeMirror 6 `drawSelection()` renders `.cm-selectionBackground` rectangles in `.cm-selectionLayer` and hides native `::selection`.

**Fix**: Target `.cm-selectionLayer .cm-selectionBackground` from the CodeMirror theme extension and include a focused selector with higher specificity than CodeMirror's base theme.

**Prevention**: When changing CodeMirror chrome, inspect CodeMirror's generated DOM/classes and base-theme selector specificity before assuming a normal CSS pseudo-element controls the UI.
