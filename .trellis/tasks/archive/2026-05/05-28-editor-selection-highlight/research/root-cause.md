# Root Cause: CodeMirror Selection Highlight

## Evidence

`@codemirror/view` documents `drawSelection()` as hiding the browser's native selection and replacing it with overlay backgrounds using the `cm-selectionBackground` class.

In `@codemirror/view@6.43.0`, the selection layer creates markers with:

```typescript
RectangleMarker.forRange(view, "cm-selectionBackground", range)
```

The layer class is:

```typescript
class: "cm-selectionLayer"
```

The built-in base theme includes:

```css
&light .cm-selectionBackground { background: #d9d9d9 }
&dark .cm-selectionBackground { background: #222 }
&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background: #d7d4f0 }
&dark.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background: #233 }
```

## Why Previous Fixes Failed

1. Native `::selection` rules do not control the visible mouse selection while `drawSelection()` is active.
2. A broad selector like `&.cm-focused .cm-selectionBackground` has lower specificity than CodeMirror's focused light/dark base-theme selector.
3. `--bg-active` is a generic UI surface token, not a text selection token, so it can be too subtle even when the rule applies.

## Fix Strategy

Use a dedicated `--cm-selection-bg` token and target the overlay layer with a focused selector that has higher specificity than CodeMirror's built-in rule:

```typescript
'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground.cm-selectionBackground': {
  background: 'var(--cm-selection-bg)',
}
```

The repeated class is deliberate. It increases specificity without using `!important`.
