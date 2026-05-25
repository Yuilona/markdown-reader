# Research: CodeMirror 6 Mermaid grammar / highlighting (editor pane)

- **Query**: Add keyword/arrow/comment syntax highlighting to a ```mermaid fenced
  block in the CM6 editor (left pane), wired through `markdown({ codeLanguages })`.
- **Scope**: mixed (npm/web + internal node_modules + existing editor code)
- **Date**: 2026-05-25
- **Tooling note**: The exa web-search MCP tools were **unavailable** in this run.
  All external facts below come from the live **npm registry** (`npm view`,
  `api.npmjs.org/downloads`) and the package's own README, which is verifiable
  and citable. No mermaid CM grammar is present in `node_modules` today (only
  `mermaid` the renderer + the `@codemirror/*` lang packages from the prior task).

---

## TL;DR Recommendation

**Hand-roll a tiny `StreamLanguage` (StreamParser).** Do **not** add
`codemirror-lang-mermaid`.

- The only real CM6 mermaid package (`codemirror-lang-mermaid`) is **1.43 MB
  unpacked / 70 files**, **last published 2023-09-14** (stale), and — most
  importantly — **does not cover the diagram types this task lists**: it supports
  only mindmap, pie, flowchart, sequence, userJourney, requirement, gantt. It has
  **no classDiagram, no stateDiagram-v2, no erDiagram**. For a small offline
  desktop app wanting low bundle cost and "decent-but-not-perfect" highlighting, a
  ~40-line StreamParser keyed on a keyword list + arrow regex is the better fit
  and lazy-loads as a near-zero chunk (matches the existing Shell entry pattern).

---

## Findings

### 1. Is there a maintained CM6 / Lezer mermaid grammar package?

| Package | Real? | CM6? | Status | Verdict |
|---|---|---|---|---|
| `codemirror-lang-mermaid` | **Yes**, v0.5.0 | **Yes** — true Lezer/CM6 grammar | **Stale**: last publish `2023-09-14`; latest is still 0.5.0 | Real but partial + heavy |
| `@codemirror/lang-mermaid` | **No** | — | npm 404 (does not exist) | N/A |
| `lezer-mermaid` | **No** | — | npm 404 (does not exist) | N/A |

`codemirror-lang-mermaid` v0.5.0 details (all from npm registry):

- **CM6 confirmed** via peerDeps: `@codemirror/language ^6.9.0`,
  `@lezer/highlight ^1.1.6`, `@lezer/lr ^1.3.10`. Pure ESM-friendly
  (`exports: { import: './dist/index.js', require: './dist/index.cjs' }`). NOT CM5.
- **Weekly downloads**: ~111,731 (week 2026-05-18 → 05-24). High, but note this is
  registry-wide pull-through (transitive/CI), not a signal of active maintenance.
- **Release history**: 0.2.0 (2023-02) → 0.5.0 (2023-09-14). **No releases since
  Sept 2023** → effectively unmaintained / "version 0.x, work-in-progress" per its
  own README ("I'm currently working on building a grammar for each diagram").
- **Size**: `dist.unpackedSize = 1,430,810` bytes (~1.43 MB), `dist.fileCount = 70`
  (one compiled Lezer grammar per diagram type → large even if lazy-loaded).
- **License**: MIT. Repo: `https://github.com/inspirnathan/codemirror-lang-mermaid`.
- **API**: exports `mermaid()` returning a `LanguageSupport` (so it *is*
  lazy-loadable as a `LanguageDescription`), plus per-diagram custom tag bundles
  (`pieTags`, `mindmapTags`, …). Custom tags each have a **parent CM tag** so a
  generic `defaultHighlightStyle` (keyword/number/string/comment) will color them
  without importing the custom tag objects.
- **Coverage (from README "Supported Diagrams")**: mindmap, pie, flowchart,
  sequence, userJourney, requirement, gantt. **Missing**: classDiagram,
  stateDiagram-v2, erDiagram, journey-vs-userJourney alias quirks, gitGraph, etc.
  → would silently fall back to no highlighting for those fences.

### 2a. If using the package — wrap as a lazy `LanguageDescription`

It exposes a `LanguageSupport` via `mermaid()`, so it drops into the existing
`codeLanguages.ts` array exactly like the JS/Python entries:

```ts
LanguageDescription.of({
  name: 'Mermaid',
  alias: ['mmd'],
  load: () => import('codemirror-lang-mermaid').then((m) => m.mermaid()),
}),
```

Its custom tags inherit standard parents, so the app's existing
`defaultHighlightStyle` / `oneDarkHighlightStyle` (already wired in
`editorExtensions.ts:130`) will color keyword/number/string/comment with **no
extra HighlightStyle work**. The cost is purely the ~1.4 MB lazy chunk + the
coverage gaps above.

### 2b. If hand-rolling — minimal `StreamLanguage` (recommended)

CM6 `StreamParser` from `@codemirror/language` — same mechanism already used for
Shell (`codeLanguages.ts:85-92`) and proposed for stex math in the sibling
research file. Map tokens to **standard `@lezer/highlight` tag *names*** that
`StreamParser.tokenTable`/the default highlighter understand: the `token()` return
string is a *style tag name* (e.g. `"keyword"`, `"operator"`, `"comment"`,
`"string"`, `"variableName"`, `"number"`), which `StreamLanguage.define` maps to
the corresponding `tags.*`. The fallback `defaultHighlightStyle` /
`oneDarkHighlightStyle` then colors them (see "Token → tag → color" below).

Keyword list to cover the common diagram surface the task asks for:

```ts
const KEYWORDS = new Set([
  // diagram headers / declarations
  'graph','flowchart','sequenceDiagram','classDiagram','stateDiagram','stateDiagram-v2',
  'erDiagram','gantt','pie','journey','mindmap','gitGraph','quadrantChart','timeline',
  'requirementDiagram','C4Context',
  // structural
  'subgraph','end','direction',
  // sequence
  'participant','actor','note','activate','deactivate','loop','alt','opt','else',
  'par','and','rect','over','left','right','of','autonumber','as',
  // class / state / er
  'class','state','title','section',
  // gantt
  'dateFormat','axisFormat','excludes','todayMarker',
  // pie
  'showData',
  // directions (also matched as standalone tokens after `direction`)
  'TB','TD','BT','RL','LR',
]);
```

Concrete StreamParser sketch (single file, lazy-imported):

```ts
// src/components/Editor/mermaidStream.ts
import type { StreamParser } from '@codemirror/language';

const KEYWORDS = new Set([/* …list above… */]);

// Order matters: longest arrows first so `-->|` etc. win over `--`.
const ARROW = /^(?:<-->|x--x|o--o|-\.->|==>|<==|===|--x|--o|-->|<--|---|--|==|-\.-|\.-|~~~)\|?/;

export const mermaidLang: StreamParser<unknown> = {
  name: 'mermaid',
  startState: () => ({}),
  token(stream) {
    // comments: %% to end of line
    if (stream.match(/^%%.*/)) return 'comment';

    // strings: "..." (and node labels often use quotes)
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';

    // edge/arrow operators (incl. -->|label| opener — label text falls through)
    if (stream.match(ARROW)) return 'operator';

    // edge label close `|`  and link-style pipes
    if (stream.match(/^\|/)) return 'operator';

    // numbers (gantt durations, pie values, sequence autonumber)
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';

    // identifiers / keywords
    const word = stream.match(/^[A-Za-z_][\w-]*/);
    if (word) {
      const w = (word as RegExpMatchArray)[0];
      if (KEYWORDS.has(w)) return 'keyword';
      return 'variableName'; // node ids, actor names, etc.
    }

    // brackets / shape delimiters → punctuation-ish; let them be operators
    if (stream.match(/^[[\](){}>]/)) return 'operator';

    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '%%' } },
};
```

Wire it into `codeLanguages.ts` mirroring the Shell entry:

```ts
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';

LanguageDescription.of({
  name: 'Mermaid',
  alias: ['mmd'],
  load: () =>
    import('./mermaidStream').then(
      (m) => new LanguageSupport(StreamLanguage.define(m.mermaidLang)),
    ),
}),
```

This keeps mermaid out of the editor main chunk (the `import('./mermaidStream')`
becomes its own ~1 KB lazy chunk), matching the file's documented goal
(`codeLanguages.ts:11-14`).

### Token → tag → color (works with the EXISTING theme, no new HighlightStyle)

The fenced-code styling in this repo is the **fallback** highlighter
(`defaultHighlightStyle` for light / `oneDarkHighlightStyle` for dark), applied at
`src/components/Editor/editorExtensions.ts:130`. The repo's *own* `markdownHighlight`
(`editorExtensions.ts:90-109`) only styles markdown structural tags
(heading/strong/link/monospace/string/processingInstruction/labelName/…) — it does
**not** style `keyword`/`operator`/`comment`/`variableName`/`number`, so those come
from the fallback highlighter and will color automatically. StreamParser tag-name
strings map to:

| `token()` returns | `@lezer/highlight` tag | colored by |
|---|---|---|
| `'keyword'` | `tags.keyword` | default/oneDark fallback |
| `'operator'` | `tags.operator` (arrows) | default/oneDark fallback |
| `'comment'` | `tags.comment` (`%%`) | default/oneDark fallback |
| `'string'` | `tags.string` | default/oneDark fallback (and repo `--cm-string`) |
| `'variableName'` | `tags.variableName` (node ids) | default/oneDark fallback |
| `'number'` | `tags.number` | default/oneDark fallback |

No new `HighlightStyle` entry is required for the hand-rolled approach; the
existing two-highlighter setup already covers these tags.

### Files Found (internal wire-in points)

| File Path | Description |
|---|---|
| `src/components/Editor/codeLanguages.ts:18-93` | `LanguageDescription[]`; **Shell entry lines 85-92 is the exact StreamLanguage pattern to mirror** for Mermaid |
| `src/components/Editor/CodeMirrorEditor.tsx:99` | `markdown({ codeLanguages })` call — no change needed; new entry flows through |
| `src/components/Editor/editorExtensions.ts:90-109` | `markdownHighlight` — does NOT style keyword/operator/comment, so no collision |
| `src/components/Editor/editorExtensions.ts:130` | `defaultHighlightStyle` / `oneDarkHighlightStyle` fallback — this is what will color the mermaid tokens |

### Related Specs

- `.trellis/tasks/05-25-editor-latex-mermaid-highlight/prd.md` — parent task; lines
  23-39 already lean toward "hand-written StreamLanguage" for mermaid.
- `.trellis/tasks/05-25-editor-latex-mermaid-highlight/research/cm6-markdown-math.md`
  — sibling research; same StreamLanguage + lazy-import mechanics for stex.
- `.trellis/tasks/archive/2026-05/05-25-editor-code-highlight/prd.md` — established
  the lazy `LanguageDescription` + `defaultHighlightStyle` fallback design.

## Caveats / Not Found

- **No web/exa search available this run** — package facts are from the npm
  registry (authoritative) but I could not cross-check community sentiment, open
  issues, or GitHub commit recency beyond npm publish dates. The 2023-09 last
  publish strongly implies unmaintained.
- `codemirror-lang-mermaid` coverage list (mindmap/pie/flowchart/sequence/
  userJourney/requirement/gantt) is from its README; **classDiagram / stateDiagram-v2
  / erDiagram are explicitly absent** — confirm against your test docs if you go
  the package route.
- The hand-rolled StreamParser arrow regex above is a starting point; mermaid's full
  edge syntax (e.g. `o--o`, `x--x`, multi-segment `A -- text --> B`) is broad. For
  "decent-but-not-perfect" this is fine; perfect tokenization would need the real
  Lezer grammar. The mid-arrow label form `A -->|text| B` highlights the arrow +
  pipes as operator and leaves `text` as variableName (acceptable).
- StreamParser `token()` return strings must be **valid default tag names**; if you
  want guaranteed mapping regardless of CM internals, instead build an explicit
  `tokenTable` mapping custom names → `tags.*` from `@lezer/highlight`.
