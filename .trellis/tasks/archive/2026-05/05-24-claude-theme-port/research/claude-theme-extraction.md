# Research: Claude "Quiet Serif / 静衬线" Typora theme — Markdown content design system

- **Query**: Extract the Markdown CONTENT design system (colors, fonts, layout, per-element styling) from the Typora Claude theme so it can be re-authored for a different app. Ignore all Typora app chrome.
- **Scope**: internal (CSS source extraction)
- **Date**: 2026-05-24
- **Sources**: `theme/_extracted/claude.css` (light), `theme/_extracted/claude-dark.css` (dark)

> Selector mapping note: Typora wraps rendered Markdown in `#write`. `#write > h1` ⇒ `h1`, `#write p` ⇒ `p`, `.md-fences` ⇒ `pre` (fenced code block), `#write pre.md-meta-block` ⇒ the YAML frontmatter block, `li.md-task-list-item > input[type=checkbox]` ⇒ task-list `li` checkbox, `.md-alert*` ⇒ GitHub alert/callout `blockquote`. `code, tt` ⇒ inline `code`. The `*` reset sets `border-width:0; border-style:solid; border-color: var(--border-color)` globally, so element "borders" only appear where a width is set.

---

## 1. Color tokens (`:root`)

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--bg-color` | `#faf9f5` | `#262624` | page background (warm paper / warm charcoal) |
| `--hover-color` | `#f0eee6` | `#141413` | hover surface |
| `--font-color` | `#141413` | `#faf9f5` | body text |
| `--border-color` | `#1f1e1d` | `#dedcd1` | base border ink (used at low opacity) |
| `--border-color-15` | `#1f1e1d26` (0.15) | `#dedcd126` | hairline borders |
| `--border-color-30` | `#1f1e1d4d` (0.30) | `#dedcd14d` | stronger borders |
| `--scrollbar-color` | `#1f1e1d59` | `#dedcd159` | scrollbar thumb |
| `--scrollbar-hover-color` | `#5a5959` | `#a5a49d` | scrollbar thumb hover |
| `--pre-bg-color` | `#ffffff80` (white 50%) | `#30302E80` | fenced code block bg |
| `--pre-border-color` | `#1f1e1d26` | `#dcdcd126` | code block border |
| `--pre-inputfont-color` | `#73726c` | `#9a9c92` | code lang-label text |
| `--hr-color` | `#1f1e1d4d` | `#dedcd14d` | horizontal rule |
| `--table-th-border` | `#1f1e1d99` (0.60) | `#dedcd199` | table header bottom border |
| `--table-td-border` | `#1f1e1d4d` (0.30) | `#dedcd14d` | table cell bottom border |
| `--code-bg-color` | `#3d3d3a0d` (~0.05) | `#c2c0b60d` | inline code bg |
| `--code-font-color` | `#8a2424` (dark red) | `#f4a9a9` (soft pink) | inline code text |
| `--code-border` | `#1f1e1d26` | `#dedcd126` | inline code border |
| `--quote-font-color` | `#3d3d3a` | `#c2c0b6` | blockquote text |
| `--quote-boder` (sic) | `#1f1e1d1a` (0.10) | `#dedcd126` | blockquote left bar |
| `--LOGO-color` | `#D97757` | `#D97757` | **Claude orange accent (identical both modes)** |
| `--focus-ring-color` | `#D97757` | `#D97757` | focus ring |
| `--outline-hover-text-color` | `#a94f2d` | `var(--font-color)` | — |
| `--button-bg-color` | `#e8e6dc` | `#30302e` | YAML/input bg |

Caret color in `#write` = `#D97757` (both). `::selection` light = `rgba(142,164,255,0.30)` bg / `#131314` text (a cool blue selection against warm paper).

---

## 2. Fonts

Font stacks identical in both modes:
- `--font-serif`: `"Anthropic Serif Web Text", Georgia, "Times New Roman", "Noto Serif SC"` — **body text uses this** (`#write { font-family: var(--font-serif) }`).
- `--font-sans`: `"Anthropic Sans Web Text", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` — used on `html, body`, code lang labels, alert titles, YAML label, footnotes.
- `--font-mono`: `"Anthropic Mono Variable", ui-monospace, monospace` — inline code, fenced code, YAML body.

Weights (the one real light/dark divergence in typography):

| | Light | Dark |
|---|---|---|
| `--font-weight` (normal) | `400` | `360` |
| `--font-strong` (bold) | `700` | `530` |
| `--pre-inputfont-weight` | `430` | `400` |

`html` `font-size: 16px`; base `line-height: 1.5`; `body { font-size: 1rem; font-weight: var(--font-weight) }`. No global `letter-spacing` (alert title container explicitly resets `letter-spacing: 0`).

---

## 3. Page width / layout (`#write`)

| Property | Value (both modes) |
|---|---|
| width | `100%` |
| max-width | **`752px`** (note: prompt guessed ~678; actual is 752px) |
| padding | `2.25rem 1rem 4.375rem 1rem` (top / x / bottom) |
| display | `flex; flex-direction: column; gap: 0.75rem` (block spacing comes from flex gap, not margins) |
| caret-color | `#D97757` |

Most block elements add their own horizontal padding of `0 2rem 0 0.5rem` (asymmetric — more on the right).

---

## 4. Body / paragraph

- Body: `font-family: var(--font-serif)` (inherited from `#write`), `font-size: 1rem`, `line-height: 1.5` (base) , `font-weight` 400/360.
- `#write p`: `padding: 0 2rem 0 0.5rem; margin: 0` (vertical rhythm from `#write` flex gap `0.75rem`).

---

## 5. Headings h1–h6 (`#write h1`…`h6`)

Color: inherits `--font-color` (NO special heading color, NO bottom border on h1/h2). Weight = `--font-strong` for h1–h4 (700 light / 530 dark); h5/h6 use literal `600`. All share `padding: 0 2rem 0 0.5rem`. Identical values in light & dark.

| | font-size | line-height | weight | margin (top / x / bottom) |
|---|---|---|---|---|
| h1 | `1.375rem` | `1.65rem` | strong | `0.75rem 0 -0.25rem 0` |
| h2 | `1.125rem` | `1.65rem` | strong | `0.75rem 0 -0.25rem 0` |
| h3 | `1rem` | `1.5rem` | strong | `0.5rem 0 -0.25rem 0` |
| h4 | `1rem` | `1.5rem` | strong | `0.5rem 0 -0.25rem 0` |
| h5/h6 | `0.875rem` | `1.25rem` | `600` | `0.5rem 0 -0.25rem 0` |

(Negative bottom margin tightens spacing before following block, working with `#write` gap.)

---

## 6. Links (`a`)

| | Light | Dark |
|---|---|---|
| color (rest) | `var(--font-color)` `#141413` | `var(--font-color)` `#faf9f5` |
| underline color (rest) | `#141413` | `#faf9f5` |
| underline offset | `2px` | `2px` |
| hover color (`a:hover`) | `#D97757` | `#E6987D` |
| hover color inside content (`#write a:hover`) | `#D97757` | **`#D4B06D` (gold)** |

Links are underlined by default (inherit decoration), turning orange/gold on hover.

---

## 7. Lists (ul/ol/li)

- Containers (`.write ul/ol`): `display:flex; flex-direction:column; gap:0.25rem; line-height:1.65rem`.
- Top-level `> ul/> ol`: `padding: 0 2rem; margin: 0 0 0.75rem 0`. Nested: `padding: 0 2rem 0.25rem 2rem; margin: 0.25rem 0 0 0`.
- `li`: `padding: 0 0 0 0.5rem; margin: 0`. `#write li > p { padding: 0 }`.
- Unordered marker: `#write ul:not(.task-list) { list-style-type: disc }` (solid bullet at all nesting levels).

**Task-list checkbox** (`li.md-task-list-item > input[checkbox]`, same both modes — hardcoded light-ish colors):
- 13×13px, `appearance:none`, absolutely positioned (`top:2px; left:2px; margin-left:-1.3em`).
- border `1px solid #d0cfce`, `border-radius:2px`, bg `#f7f6f5`.
- checked: bg `#d0d0cf`, border `#d0cfce`; `::after` draws a rotated 45° check stroke `5×9px border solid #ececec` (border-width `0 2px 2px 0`).

---

## 8. Blockquote (`blockquote`)

| Property | Light | Dark |
|---|---|---|
| background | transparent | transparent |
| text color | `var(--quote-font-color)` `#3d3d3a` | `#c2c0b6` |
| left bar | `border-left-width: 4px`, color `var(--quote-boder)` `#1f1e1d1a` | `#dedcd126` |
| margin | `0 0 0 0.5rem` | same |
| padding | `0 2rem 0 0.5rem` | same |
| font-style | not italicized (left default) | same |

`blockquote > p`: `padding: 0 2rem 0 0.5rem; margin:0`. Nested lists: `padding:0 32px; margin:0 0 12px 0`.

---

## 9. Horizontal rule (`hr`)

Both modes: `border: none; border-top-style: solid; border-top-width: 1px; border-color: var(--hr-color)` (`#1f1e1d4d` light / `#dedcd14d` dark); `margin: .75rem .375rem`.

---

## 10. Tables

Minimalist, **no outer border, no zebra striping, no border-radius** — only horizontal hairline rules.
- Figure wrapper (`.md-table-fig`): no border/bg/shadow/radius; `margin-bottom:1.5rem; padding:0 0.5rem`.
- `table`: `border:none; width:100%; line-height:1.65rem`.
- `th, td`: `font-size:0.875rem; line-height:1.7; padding:0.5rem 1rem 0.5rem 1px`; only `border-bottom-width:0.5px` (no left/right/top). `thead` and last row get explicit solid bottom borders.
- `th` bottom-border color `var(--table-th-border)` (`#1f1e1d99` light / `#dedcd199` dark), weight = `--font-strong`.
- `td` bottom-border color `var(--table-td-border)` (`#1f1e1d4d` / `#dedcd14d`), weight = `--font-weight`.
- (Print fallback bumps the 0.5px borders to 1px since 0.5px disappears in PDF.)

---

## 11. Inline code (`code, tt`)

| Property | Light | Dark |
|---|---|---|
| font-family | `var(--font-mono)` | same |
| background | `var(--code-bg-color)` `#3d3d3a0d` | `#c2c0b60d` |
| text color | `var(--code-font-color)` **`#8a2424`** (dark brick red) | **`#f4a9a9`** (soft pink) |
| font-size | `0.9rem` | same |
| border-radius | `0.4rem` | same |
| border | `0.5px` solid `var(--code-border)` (`#1f1e1d26` / `#dedcd126`) | — |
| padding | `1px 0.25rem` | same |
| line-height | `21.6px` | same |

---

## 12. Code block container (fenced `pre` = `.md-fences`)

Token/syntax colors out of scope. Container only:
- `padding: 2.8rem 0.875rem 0.875rem 0.875rem` (extra top room for the language label), `margin:0`.
- background `var(--pre-bg-color)` (`#ffffff80` light / `#30302E80` dark — semi-transparent over the warm bg).
- border `0.5px solid var(--pre-border-color)` (`#1f1e1d26` / `#dcdcd126`).
- **border-radius `0.5rem` (8px)**.
- Code text (`.CodeMirror-lines`): `font-family: var(--font-mono); font-size:0.875rem; line-height:1.625; font-weight: var(--font-weight)`.
- **Language label**: `.md-fences[lang]::before { content: attr(lang) }` positioned top-left, `padding:14px 0 0 15px`, `font-family: var(--font-sans); font-size:0.75rem`, color `var(--pre-inputfont-color)`, weight `var(--pre-inputfont-weight)`. (Re-author as a `::before` reading a `data-lang`/`lang` attribute.)

---

## 13. Images

No explicit `img` rules in either content stylesheet — images fall back to Typora/browser defaults (no theme-imposed border-radius, shadow, or centering). If porting, this is intentionally unstyled; choose your own defaults.

---

## 14. GitHub alerts / callouts (`.md-alert` = a styled `blockquote`)

Base container (`#write .md-alert`): `position:relative; margin:0.25rem 2rem 0.75rem 0.5rem; padding:~0.72rem 0.9rem 0.78rem 1rem; border:1px solid var(--alert-border); border-left:3px solid var(--alert-accent); border-radius:8px`. Background is a layered gradient: `linear-gradient(180deg, var(--alert-bg), var(--alert-bg-soft)), linear-gradient(90deg, var(--alert-wash), transparent ~32%)`. Subtle drop shadow `0 12px 28px -26px var(--alert-shadow)` (light) / `0 14px 30px -28px ...` (dark).

Title row (`.md-alert-text`): flex, `font-family: var(--font-sans); font-size:0.78rem; font-weight:700; color: var(--alert-accent)`. Icon `svg` 1rem, `fill: currentColor`, `margin-right:0.42rem`. Alert inline `code` gets a lighter surface (`rgb(255 255 255 / 48%)` light) + `border-color: var(--alert-border)`.

Per-type accent (`--alert-accent`) and key tints:

| Type | Light accent | Dark accent | bg / border pattern |
|---|---|---|---|
| default | `#D97757` (LOGO) | `#D97757` | white-ish bg / ink border |
| note | `#5d7d9a` (blue) | `#88a9c7` | accent @ ~10% bg, ~22% border |
| tip | `#688a5d` (green) | `#91b685` | accent @ ~11% bg, ~24% border |
| important | `#8b6f9d` (purple) | `#b69acd` | accent @ ~11% bg, ~24% border |
| warning | `#ad7837` (amber) | `#d6a15e` | accent @ ~12% bg, ~25% border |
| caution | `#b45f51` (red-brown) | `#d88678` | accent @ ~11% bg, ~24% border |

(Dark variants are the lighter/desaturated siblings of the light hues. Each `--alert-bg` ≈ accent at 10–12%, `--alert-bg-soft` ≈ 3–4%, `--alert-wash` ≈ 12–14%, `--alert-border` ≈ 22–25%.)

---

## 15. YAML frontmatter (`#write pre.md-meta-block`)

The single most decorative element — an aged-paper "card":
- `font-family: var(--font-mono); font-size:0.82rem; line-height:1.65`; text color `rgba(74,50,31,0.78)` light / `rgba(234,216,174,0.76)` dark.
- `border-radius:10px`, `border:1px solid transparent`, `overflow:hidden`, `backdrop-filter: blur(10px) saturate(1.04)`.
- Background = stacked layers: dashed-line frame (`rgba(117,73,36,0.24)` light / `rgba(225,179,110,0.22)` dark drawn as repeating linear-gradients on all 4 edges), a faint vertical guide line, horizontal ruled lines (`repeating-linear-gradient`), two radial light glints, and a warm diagonal paper gradient (`linear-gradient(135deg, rgba(255,244,206,0.68), rgba(229,205,148,0.36))` light).
- `box-shadow`: `0 6px 18px rgba(55,38,22,0.06)` + inset highlights; `text-shadow: 0 1px 0 rgba(255,255,255,0.28)`.
- `::before` prints a **"YAML"** label (sans, `0.68rem`, weight 700, color `rgba(111,67,31,0.62)` / `rgba(255,215,150,0.62)`) with a hairline bottom rule.
- `::after` overlays a faint dotted paper-grain texture (`mix-blend-mode: soft-light`, opacity 0.62).

---

## 16. Special behaviors (the "look" signatures)

1. **Highlight `==mark==` → wavy underline, no background.** `span[md-inline="highlight"] mark { background:transparent; text-decoration: underline wavy <color>; text-underline-offset:3px }`. Color = **`#D97757` (orange) in light, `#D4B06D` (gold) in dark.** Preserved in `@media print` too.
2. **Manual underline `u` → solid `#D97757` underline** (both modes), `text-underline-offset:3px`.
3. **Dark-mode bold = color shift, not just weight.** Dark `#write strong { font-weight: var(--font-strong) /*530*/; color: #E6987D }` (warm salmon). Light has no strong color (just weight 700). Inline-code red also flips: `#8a2424` → `#f4a9a9`.
4. **Hidden Markdown control chars.** `#write .md-pair-s.md-expand > .md-meta.md-before/.md-after` (the `*`/`_`/`==` marker glyphs Typora reveals on focus) are collapsed to `width:0; font-size:0; opacity:0` — markers never visibly appear.
5. **Footnotes** (`sup.md-footnote`): sans, tiny (`0.52em`), color `#8a3f27` light / `#f0a486` dark, hover `#71301d` / `#ffbd9f`.
6. **Content scrollbar**: `::-webkit-scrollbar { width:6px }`, thumb `var(--scrollbar-color)` `border-radius:8px`, hover `var(--scrollbar-hover-color)`.

---

## 17. Border radii (the scale)

Reference tokens (both modes): `--raduis-8: 8px`, `--raduis-12: 12px`, `--raduis-20: 20px` (note misspelling "raduis"). Applied in content: inline code `0.4rem`(~6.4px), fenced code `0.5rem`(8px), alerts `8px`, YAML block `10px`, task checkbox `2px`. (12px/20px are mostly app-chrome.)

---

## 18. Box shadows (content elements)

- **Tables, blockquotes, images, headings, hr: NO shadow.**
- Fenced code container: no shadow (border only).
- Alerts: very soft `0 12px 28px -26px var(--alert-shadow)` (light) / `0 14px 30px -28px` (dark) — barely-there lift.
- YAML block: `0 6px 18px rgba(55,38,22,0.06)` + inset highlight rings (light); `0 6px 18px rgba(0,0,0,0.14)` + insets (dark).
- Footnote hover tooltip: `0 10px 28px rgb(70 44 22 / 16%), 0 2px 6px rgb(70 44 22 / 10%)` on `#fffaf1` card.

---

## Caveats / Not Found

- **Page width is 752px, not the ~678px guessed** in the brief.
- **No `img` styling** exists in either content stylesheet (browser/Typora default).
- Heading colors/borders: none beyond inherited `--font-color` (no h1/h2 underline rule in content scope).
- The `*` reset gives every element `border-style:solid; border-width:0; border-color: var(--border-color)`; re-authoring outside Typora must set widths explicitly per element.
- Custom fonts ("Anthropic Serif/Sans/Mono Web") are referenced but the `@font-face`/font files were not searched here — confirm availability when porting (they fall back to Georgia / system-ui / ui-monospace).
- Syntax-highlight token colors (`.cm-*`) intentionally excluded per scope.
