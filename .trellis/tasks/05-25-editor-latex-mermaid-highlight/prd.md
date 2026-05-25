# Editor: LaTeX math + Mermaid syntax highlighting (CodeMirror 6)

## Goal

In the split-view editor (left CodeMirror pane), fenced code blocks already get
language syntax highlighting, but **LaTeX math** (`$…$` / `$$…$$`, KaTeX delimiters —
NOT fenced) and **Mermaid** fenced blocks (```mermaid) render as plain monospace. Add
keyword/syntax highlighting for both so the editor matches the richness of the preview.
Preview (Shiki) is out of scope — editor only.

## What I already know

- Editor: `src/components/Editor/CodeMirrorEditor.tsx` uses `markdown({ codeLanguages })`
  (`@codemirror/lang-markdown`). Fenced-language highlighting comes from
  `src/components/Editor/codeLanguages.ts` — a `LanguageDescription[]` with lazy
  dynamic-import loaders (JS/TS/Python/JSON/CSS/HTML/Rust/Go/SQL/YAML/Markdown/Shell).
  Shell uses `StreamLanguage` from `@codemirror/legacy-modes`.
- Token colors come from `themeExtension(effective)` (editorExtensions.ts):
  `syntaxHighlighting(markdownHighlight)` (var-driven `--cm-*`) + a non-fallback
  `syntaxHighlighting(defaultHighlightStyle | oneDarkHighlightStyle)` for fenced-code
  tokens. So once a nested language tags tokens, they get colored by that highlighter.
- Two DIFFERENT mechanisms are needed:
  - **Mermaid** = a fenced block (```mermaid) → add an entry to `codeLanguages`. But CM6
    has no official mermaid grammar → likely a hand-written `StreamLanguage`.
  - **LaTeX math** = `$…$` / `$$…$$` delimiters, NOT fenced → needs a markdown parser
    extension (`markdown({ extensions: [...] })`) that recognizes the `$`/`$$` math
    nodes and nests a LaTeX/stex grammar. (```latex fenced blocks could ALSO be added
    to codeLanguages via `@codemirror/legacy-modes/mode/stex`.)
- Math in this app uses KaTeX via remark-math, so source delimiters are `$…$`
  (inline) and `$$…$$` (block).

## Assumptions (temporary)

- LaTeX token grammar = `@codemirror/legacy-modes/mode/stex` (StreamLanguage) for both
  fenced ```latex and the nested `$$` math content.
- Mermaid highlighting = a small hand-written `StreamLanguage` (keywords like graph/
  flowchart/sequenceDiagram/subgraph + arrows `-->`/`---`/`==>` + comments `%%`), since
  no maintained CM6 mermaid grammar is expected.
- Lazy-load both via dynamic import (match the existing codeLanguages pattern), so they
  don't bloat the editor chunk.

## Open Questions

- [PREFERENCE] Math scope: only `$$…$$` block math, or also inline `$…$`? (inline math
  highlighting can be noisier / more false-positive-prone for `$` in prose.)
- [PREFERENCE] Mermaid thoroughness: minimal keyword/arrow highlighting vs richer.
- (defer until research) Is there a maintained CM6/Lezer math + mermaid package worth
  using instead of hand-rolling?

## Requirements (evolving)

- R1. Mermaid fenced blocks (```mermaid) get keyword/arrow/comment highlighting in the editor.
- R2. LaTeX math (`$$…$$` at least; `$…$` TBD) gets command/brace/etc. highlighting.
- R3. ```latex / ```tex fenced blocks also highlight (cheap add via stex).
- R4. Lazy-loaded; no measurable editor-chunk bloat; theme-aware (light/dark) coloring.
- R5. No change to preview (Shiki) or to the rendered output — editor only.

## Acceptance Criteria (evolving)

- [ ] A ```mermaid block in the editor shows colored keywords/arrows (not flat mono).
- [ ] A `$$ … $$` math block shows colored LaTeX commands/braces.
- [ ] ```latex fenced block highlights.
- [ ] Light + dark themes both color the new tokens sensibly.
- [ ] tsc + vitest + vite build green; no editor-chunk size regression of note.

## Definition of Done

- Tests where sensible (e.g. the StreamLanguage tokenizer, or a smoke test that the
  extension wires up). Lint/typecheck/build green. docs/theming.md `--cm-*` section
  updated if new token categories are exposed.

## Decision (ADR-lite)

**Context**: No maintained CM6 packages for either math or mermaid worth adopting
(math: none exist; mermaid: `codemirror-lang-mermaid` is stale/1.4MB/incomplete).

**Decision**:
- **Math** = inline `$…$` + block `$$…$$` (matches remark-math in preview). Hand-roll a
  small `@lezer/markdown` `MarkdownConfig` (`defineNodes` + `parseBlock`/`parseInline`)
  and nest `StreamLanguage.define(stexMath)` (`@codemirror/legacy-modes/mode/stex`) via
  the config-level `wrap: parseMixed(...)` field (no `nest` on NodeSpec). Inline uses
  strict open/close rules (no space after opener, handle escaped `\$`) to limit prose
  false-positives. Lazy-loaded into the editor chunk.
- **Mermaid** = hand-rolled ~40-line `StreamLanguage` (mirrors the Shell entry), solid
  keyword set (graph/flowchart/sequenceDiagram/classDiagram/stateDiagram-v2/erDiagram/
  gantt/pie/journey/subgraph/end/participant/note/loop/alt/opt/direction…), arrows
  (`-->`,`---`,`==>`,`-.->`,`-->|label|`), `%%` comments, strings → standard highlight
  tags. Added to `codeLanguages` (lazy import).
- **```latex / ```tex fenced** = stex StreamLanguage entry in `codeLanguages` (cheap).
- Coloring reuses the existing `defaultHighlightStyle`/`oneDarkHighlightStyle` fallback
  in editorExtensions.ts — no new HighlightStyle needed.

**Consequences**: All hand-rolled (no new heavy deps); decent-not-perfect highlighting;
inline `$` may rarely mis-tokenize despite strict rules.

## Out of Scope (explicit)

- Preview/Shiki highlighting (already rich; not touched).
- Full LaTeX/mermaid language servers, linting, autocomplete, or error checking.
- Rendering/altering the actual math or diagram output.

## Research References

- [`research/cm6-markdown-math.md`](research/cm6-markdown-math.md) — how to highlight `$…$`/`$$…$$` in CM6 markdown (pending).
- [`research/cm6-mermaid-grammar.md`](research/cm6-mermaid-grammar.md) — mermaid CM6 grammar options / StreamLanguage approach (pending).

## Technical Notes

- Wire-in points: `markdown({ codeLanguages, extensions })` in CodeMirrorEditor.tsx;
  add entries to `codeLanguages.ts`; token colors already handled by editorExtensions.ts.
- Keep the lazy dynamic-import pattern for any new grammar.
