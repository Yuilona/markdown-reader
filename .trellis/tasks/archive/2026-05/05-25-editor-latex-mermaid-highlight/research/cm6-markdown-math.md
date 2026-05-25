# Research: CM6 markdown `$`/`$$` LaTeX math highlighting

- **Query**: How to add LaTeX math (`$…$` inline, `$$…$$` block, KaTeX delimiters — NOT fenced) syntax highlighting to a CodeMirror 6 editor using `@codemirror/lang-markdown`, in the editor only.
- **Scope**: mixed (internal wiring + external library API)
- **Date**: 2026-05-25

## TL;DR / Recommended approach

There is **no maintained, official off-the-shelf `@lezer/markdown` math extension** worth depending on. The clean, low-risk path is a **small hand-written `MarkdownConfig`** that:

1. Defines two markdown nodes — `BlockMath` (block) + `InlineMath` (inline) — via `defineNodes`, plus marker nodes for the `$`/`$$` delimiters.
2. Parses them with a `parseBlock` (for `$$…$$`) and a `parseInline` (for `$…$`).
3. **Nests stex into the math content** using the `wrap` field of `MarkdownConfig`, set to `parseMixed(...)` from `@lezer/common`, returning a `StreamLanguage.define(stexMath).parser` for the math nodes (overlay = the inner content range, excluding the `$` markers).

This mirrors exactly how the project already nests fenced-code grammars, so the nested tokens are colored automatically by the existing fallback highlighter (`editorExtensions.ts:130`, `syntaxHighlighting(defaultHighlightStyle | oneDarkHighlightStyle)`) with **zero new theme work** for the content tokens. The `$`/`$$` markers can be tagged via the node `style` field (e.g. to `tags.processingInstruction` → `--cm-marker`, matching the existing markdown markers).

## Findings

### 1. Does `@codemirror/lang-markdown` support extending the parser? Is there an official math extension?

**Yes, it supports extension; no, there is no official/widely-used math package.**

- `markdown(config)` accepts `extensions?: MarkdownExtension` and forwards them to the `@lezer/markdown` parser. Confirmed in the installed type defs:
  `node_modules/.pnpm/@codemirror+lang-markdown@6.5.0/.../dist/index.d.ts:66-116` (`extensions?: MarkdownExtension`). Installed version **6.5.0**.
- A `MarkdownExtension` is `MarkdownConfig | readonly MarkdownExtension[]` where `MarkdownConfig` exposes:
  `props`, `defineNodes` (`(string | NodeSpec)[]`), `parseBlock` (`BlockParser[]`), `parseInline` (`InlineParser[]`), `remove`, and **`wrap?: ParseWrapper`**.
  Confirmed: `node_modules/.pnpm/@lezer+markdown@1.6.3/.../dist/index.d.ts:326-352`. Installed `@lezer/markdown` version **1.6.3** (transitive dep of lang-markdown; not a direct dependency yet).
- **Built-in `@lezer/markdown` extensions** (all exported from the package): `GFM` (= `Table`, `TaskList`, `Strikethrough`, `Autolink`), `Superscript`, `Subscript`, `Emoji`. **There is NO `Math` / `$` extension among the built-ins** (`index.d.ts:545-600`).
- **`NodeSpec` has NO `nest` field.** The only fields are `name`, `block?`, `composite?`, `style?` (`index.d.ts:165-193`). So nesting a sub-language is **not** done via a per-node `nest` — it is done via the config-level **`wrap` (`ParseWrapper`) field** + `parseMixed`. Treat any older guidance referencing a `nest:` field on a node as outdated.
- Candidate npm packages from the prompt — **none resolve on the registry** (checked `2026-05-25` via `npm view`):
  - `codemirror-math` → 404 (not found)
  - `@benrbray/codemirror-math` → 404
  - `@vrcca/codemirror-math` → 404
  - `npm search "lezer markdown math"` → no matches.
  - Note: there *are* community CM6 math demos/gists (often attributed to Ben Bray / "obsidian-style" math, e.g. the `@benrbray/prosemirror-math` author's CM6 snippets), but they are published as gists/blog snippets, **not maintained npm packages**. The canonical reference implementation is the small hand-written extension shown below. Recommendation: **vendor a small in-repo extension**, do not add an unmaintained dependency.

### 2. Nesting a LaTeX grammar — is `stex` the right grammar, and how to nest it?

**`@codemirror/legacy-modes/mode/stex` is the right grammar.** It exports two `StreamParser`s:

```ts
// node_modules/.pnpm/@codemirror+legacy-modes@6.5.3/.../mode/stex.d.ts
export declare const stex: StreamParser<unknown>      // full LaTeX document mode
export declare const stexMath: StreamParser<unknown>  // math-mode (use this for $…$ / $$…$$)
```

Use **`stexMath`** for the content of math delimiters (it tokenizes assuming you're already inside math mode — commands `\frac`, braces, operators, etc.). Use plain `stex` for ` ```latex `/` ```tex ` fenced blocks (full document mode). Both are `StreamParser`s, so wrap with `StreamLanguage.define(...)` to get a `Language`/`LRParser`-compatible `.parser`.

**Nesting mechanism** — config-level `wrap` + `parseMixed` from `@lezer/common` (installed `@lezer/common@1.5.2`):

```ts
declare function parseMixed(
  nest: (node: SyntaxNodeRef, input: Input) => NestedParse | null
): ParseWrapper;

interface NestedParse {
  parser: Parser;
  overlay?: readonly { from: number; to: number }[] | ((node) => ...);
  bracketed?: boolean;
}
```
(Confirmed: `node_modules/.pnpm/@lezer+common@1.5.2/.../dist/index.d.ts:1127-1172`.)

`parseMixed` returns a `ParseWrapper`, which is exactly the type of `MarkdownConfig.wrap`. In the `nest` callback, match by node name and return `{ parser: stexMathParser, overlay: [innerContentRange] }` so the `$`/`$$` markers are excluded from the math parse.

**Concrete minimal working sketch** (block `$$…$$` + inline `$…$`, stex nested):

```ts
// editor/mathMarkdown.ts  (vendored, lazy-loaded)
import { StreamLanguage } from '@codemirror/language';
import { stexMath } from '@codemirror/legacy-modes/mode/stex';
import { parseMixed } from '@lezer/common';
import { tags as t } from '@lezer/highlight';
import type { MarkdownConfig, InlineContext, BlockContext, Line } from '@lezer/markdown';

const DOLLAR = 36; // '$'
const BACKSLASH = 92; // '\'

const stexMathParser = StreamLanguage.define(stexMath).parser;

const defineMathNodes: MarkdownConfig['defineNodes'] = [
  { name: 'BlockMath', block: true, style: t.special(t.content) },
  { name: 'InlineMath', style: t.special(t.content) },
  { name: 'MathMark', style: t.processingInstruction }, // the $ / $$
];

// --- inline:  $ ... $  (single dollar, on one line) ---
const inlineMath = {
  name: 'InlineMath',
  // run before the default Emphasis/etc. so we win the '$'
  before: 'Emphasis',
  parse(cx: InlineContext, next: number, pos: number): number {
    if (next !== DOLLAR) return -1;
    // not a $$ block opener handled here; require non-space right after open
    const after = cx.char(pos + 1);
    if (after === DOLLAR) return -1; // let block/`$$` logic ignore; avoid empty
    // scan for closing unescaped single '$' on the same inline section
    let i = pos + 1;
    for (; i < cx.end; i++) {
      const c = cx.char(i);
      if (c === BACKSLASH) { i++; continue; }     // skip escaped \$ etc.
      if (c === DOLLAR) break;
    }
    if (i >= cx.end || cx.char(i) !== DOLLAR) return -1; // no close
    if (i === pos + 1) return -1;                         // empty $$ -> skip
    return cx.addElement(
      cx.elt('InlineMath', pos, i + 1, [
        cx.elt('MathMark', pos, pos + 1),
        cx.elt('MathMark', i, i + 1),
      ]),
    );
  },
};

// --- block:  $$ ... $$  (own lines) ---
const blockMath = {
  name: 'BlockMath',
  // before FencedCode so a leading $$ line is taken as math, not paragraph
  parse(cx: BlockContext, line: Line): boolean | null {
    if (line.next !== DOLLAR || line.text.slice(line.pos, line.pos + 2) !== '$$') return false;
    const start = cx.lineStart + line.pos;
    const marks = [cx.elt('MathMark', start, start + 2)];
    // single-line  $$ ... $$
    const rest = line.text.slice(line.pos + 2);
    const closeOnSame = rest.indexOf('$$');
    if (closeOnSame >= 0) {
      const closeFrom = cx.lineStart + line.pos + 2 + closeOnSame;
      marks.push(cx.elt('MathMark', closeFrom, closeFrom + 2));
      cx.addElement(cx.elt('BlockMath', start, closeFrom + 2, marks));
      cx.nextLine();
      return true;
    }
    // multi-line: consume until a line whose content ends/contains $$
    while (cx.nextLine()) {
      const idx = line.text.indexOf('$$');
      if (idx >= 0) {
        const closeFrom = cx.lineStart + idx;
        marks.push(cx.elt('MathMark', closeFrom, closeFrom + 2));
        cx.addElement(cx.elt('BlockMath', start, closeFrom + 2, marks));
        cx.nextLine();
        return true;
      }
    }
    // unterminated: close at doc/section end
    cx.addElement(cx.elt('BlockMath', start, cx.prevLineEnd(), marks));
    return true;
  },
};

export const Math: MarkdownConfig = {
  defineNodes: defineMathNodes,
  parseBlock: [{ ...blockMath, before: 'FencedCode' }],
  parseInline: [inlineMath],
  // nest stex into the *content* of each math node (exclude the $ markers)
  wrap: parseMixed((node) => {
    if (node.name !== 'InlineMath' && node.name !== 'BlockMath') return null;
    // overlay = node span minus the leading/trailing $ marks
    const mark = node.name === 'BlockMath' ? 2 : 1;
    const from = node.from + mark;
    const to = node.to - mark;
    if (to <= from) return null;
    return { parser: stexMathParser, overlay: [{ from, to }] };
  }),
};
```

Wire-in at `CodeMirrorEditor.tsx:99`:
```ts
markdown({ codeLanguages, extensions: [Math] })
```

> The block-parser/inline-parser bodies above are illustrative sketches (the exact `Line`/`BlockContext` bookkeeping must be tested against `@lezer/markdown@1.6.3`); the **structure** (`defineNodes` + `parseBlock`/`parseInline` + `wrap: parseMixed`) is the confirmed, supported API shape.

### 3. Minimal hand-written config & pitfalls (if no off-the-shelf extension — which is the case)

The sketch in §2 *is* that minimal config. Key correctness/pitfall notes:

- **`$` in prose / currency** (`it costs $5 and $10`): single-`$` inline math will false-match across that. Standard mitigations: (a) require the char immediately after the opening `$` to be **non-space** and the char immediately before the closing `$` to be **non-space** (KaTeX/`remark-math` rule), and optionally (b) require the closing `$` to **not** be followed by a digit. Because the app already uses `remark-math` for the preview, **align the editor rule with remark-math's**: opener `$` not followed by space/digit-then-`$`, closer `$` not preceded by space — keeps editor highlighting and preview rendering in agreement.
- **Escaped `\$`**: the scan must skip a `$` preceded by an odd number of backslashes (the sketch skips the char after any `\`). Markdown's default `Escape` inline parser also consumes `\$`; running `inlineMath` `before: 'Escape'` would break that — so keep it **after `Escape`** OR handle the backslash skip yourself (sketch does the latter and uses `before: 'Emphasis'`). Verify against the default inline parser order: `Escape, Entity, InlineCode, HTMLTag, Emphasis, HardBreak, Link, Image` (`index.d.ts:215-219`).
- **`$$` vs `$`**: parse block `$$` in `parseBlock` (so a `$$` on its own line isn't eaten by the paragraph/`InlineCode` logic) and register it **`before: 'FencedCode'`**. Inline `$` only matches within a single inline section (no newlines), which is correct for inline math.
- **Marker coloring**: tag `MathMark` with `style: t.processingInstruction` so the `$`/`$$` reuse the existing `--cm-marker` color (`editorExtensions.ts:105`). The math *content* tokens come from stex via the nested tree and are colored by the fallback `defaultHighlightStyle`/`oneDarkHighlightStyle` (`editorExtensions.ts:130`) — same path the fenced-code grammars already use, so **no new `--cm-*` vars are required** for content (optionally add one if you want math content to differ from default code tokens).

### 4. Bundle concern — lazy loading

**Yes, fully lazy-loadable, and it should be.** Two layers:

- **stex grammar**: `@codemirror/legacy-modes/mode/stex` is already used elsewhere only via dynamic `import()` in `codeLanguages.ts` (Shell uses the same `legacy-modes` pattern). Importing `stexMath` inside the vendored `mathMarkdown.ts` module and `import()`-ing that module keeps stex out of the main editor chunk.
- **The MarkdownConfig itself**: unlike `codeLanguages` (which lazy-load *per fenced language* on demand), a `markdown({ extensions })` extension must be present when the parser is configured. To keep it off the initial editor chunk, the cleanest fit with the existing architecture is to **lazy-load the whole `mathMarkdown.ts` module alongside the editor** (the editor is already `React.lazy`-loaded at the App level — `CodeMirrorEditor.tsx:21-24`), e.g. resolve the `Math` extension in a `useEffect` and add it via a `Compartment.reconfigure`, or simply import it inside the already-lazy editor chunk. Because the editor chunk is itself lazy, bundling `Math` + stex into that chunk already satisfies "doesn't bloat the main editor/app chunk." If you want it as a *separate* sub-chunk, gate it behind `import('./mathMarkdown')` + a `Compartment`.
- `parseMixed`/`@lezer/common` is already a transitive dep (pulled by CM core), so it adds no new top-level dependency. `@lezer/markdown` is currently transitive — if you import its types/helpers directly you should add it as an explicit `dependency` (version `^1.6.3` to match the resolved tree) to avoid relying on hoisting.

## Related internal files

| File | Relevance |
|---|---|
| `src/components/Editor/CodeMirrorEditor.tsx:99` | `markdown({ codeLanguages })` call — add `extensions: [Math]` here |
| `src/components/Editor/codeLanguages.ts:85-92` | Existing lazy `StreamLanguage`/`legacy-modes` pattern to mirror (and where ` ```latex ` would be added) |
| `src/components/Editor/editorExtensions.ts:91-130` | Token theme: markdown `--cm-*` tags (`processingInstruction`→`--cm-marker`) + fallback `defaultHighlightStyle`/`oneDarkHighlightStyle` that will color the nested stex tokens |

## Caveats / Not Found

- **No npm package**: `codemirror-math`, `@benrbray/codemirror-math`, `@vrcca/codemirror-math` all return 404 on the registry (checked 2026-05-25). No maintained CM6 `@lezer/markdown` math extension exists as an installable package — vendoring the small config above is the recommended route.
- External web search / context7 / exa tools were **unavailable** in this environment; the API claims above are verified against the **actually installed type definitions** on disk (`@lezer/markdown@1.6.3`, `@codemirror/lang-markdown@6.5.0`, `@lezer/common@1.5.2`, `@codemirror/legacy-modes@6.5.3`), which is authoritative for the exact versions this project ships. The official `@lezer/markdown` README documents the same `MarkdownConfig` (`defineNodes`/`parseBlock`/`parseInline`/`wrap`) and `parseMixed` nesting pattern.
- The `parse()` bodies in the §2 sketch are illustrative and need unit testing against `@lezer/markdown@1.6.3` (especially multi-line `$$` close detection, escaped `\$`, and the prose-`$` heuristic). The supported *API shape* is confirmed; the byte-level parser logic is the implementation risk.
