# Research: Font sourcing — Source Serif 4 / Inter / JetBrains Mono (Latin variable woff2)

- **Query**: Bundle 3 open-licensed fonts as Latin-subset variable woff2 into a Tauri 2 + Vite + React app, loaded via `@font-face` from the app's own `'self'` origin (CSP `font-src 'self' data:`). CJK NOT bundled.
- **Scope**: external (npm registry / fontsource) + internal (existing `src/styles/fonts.css` pattern)
- **Date**: 2026-05-25

> All numbers below were obtained by actually installing the three `@fontsource-variable/*` packages from the npm registry (versions pinned below) and inspecting `metadata.json`, the generated `.css`, the bundled `LICENSE`, and `ls -la` of `files/`. They are not estimates from memory.

## TL;DR Recommendation

All three fonts are **SIL OFL-1.1** (freely redistributable inside a closed-source installer, no royalty). All three are available as **fontsource variable packages that ship a Latin-subset `wght`-axis variable woff2 + the OFL `LICENSE` file**. There IS a real official variable (`wght`) woff2 for **all three** — Source Serif 4 and JetBrains Mono are NOT static-only, so no need to bundle multiple static weights.

For THIS app, the lowest-friction + smallest-bundle path is **manual copy of the 3 latin `wght-normal` woff2 files into `src/assets/fonts/`** and hand-writing 3 `@font-face` rules in `src/styles/fonts.css` (mirroring the existing Sarasa pattern). This avoids pulling the cyrillic/greek/vietnamese subset files that `import '@fontsource-variable/<x>'` would drag in. Total added weight: **~139 KB** (3 files, normal-style only).

## Findings

### 1. Licenses — all SIL OFL 1.1 (safe to redistribute in a closed-source installer)

| Font | License | npm `license` field | Attribution holder |
|---|---|---|---|
| Source Serif 4 | **OFL-1.1** | `OFL-1.1` | Google Inc. (Adobe-origin) |
| Inter | **OFL-1.1** | `OFL-1.1` | The Inter Project Authors (rsms) |
| JetBrains Mono | **OFL-1.1** | `OFL-1.1` | The JetBrains Mono Project Authors |

OFL-1.1 obligations relevant here:
- **Redistribution is explicitly allowed**, including bundled inside another (even proprietary/closed-source) program. The app does not become open-source by bundling them.
- **You MUST ship the OFL license text** alongside the font files (the `LICENSE`/`OFL.txt` must travel with the binaries). Each fontsource package already includes a `LICENSE` file at its root — copy it next to the woff2 (e.g. `src/assets/fonts/OFL-<font>.txt`) so it ends up in the installer.
- The font **cannot be sold by itself** (it may be bundled into a product that is sold — that's fine; selling the *font file standalone* is what's prohibited).
- You **must not use the Reserved Font Name** ("Source Serif 4", "Inter", "JetBrains Mono") for a *modified* version. We are shipping unmodified subsets (Latin glyph subset only), which is permitted; subsetting is not a "modification" that triggers the rename rule, but keep the files unmodified-by-tooling beyond subsetting. (fontsource already produces the subset; we just copy.)
- No active runtime attribution UI is required, but shipping the license file satisfies the notice obligation. A line in `docs/theming.md` / README crediting the three fonts + OFL is good practice.

### 2. Canonical source — fontsource variable npm packages (stable, citable)

Prefer fontsource over hand-subsetting from upstream GitHub: fontsource republishes Google Fonts' / upstream's official files, pre-subsets them per script, and bundles the OFL `LICENSE`. Pinned versions verified:

| npm package | Version verified | Ships Latin variable woff2? | Bundles OFL LICENSE? |
|---|---|---|---|
| `@fontsource-variable/source-serif-4` | 5.2.9 | Yes — `source-serif-4-latin-wght-normal.woff2` | Yes (`LICENSE`) |
| `@fontsource-variable/inter` | 5.2.8 | Yes — `inter-latin-wght-normal.woff2` | Yes (`LICENSE`) |
| `@fontsource-variable/jetbrains-mono` | 5.2.8 | Yes — `jetbrains-mono-latin-wght-normal.woff2` | Yes (`LICENSE`) |

Each package layout (after `npm/pnpm install`):
```
node_modules/@fontsource-variable/<font>/
├── LICENSE                # OFL-1.1 text — ship this
├── files/                 # all subsets × axes × styles woff2
│   ├── <font>-latin-wght-normal.woff2     <-- the one we want
│   ├── <font>-latin-wght-italic.woff2
│   ├── <font>-cyrillic-wght-normal.woff2  (don't need)
│   ├── <font>-greek-*.woff2               (don't need)
│   └── ...
├── wght.css               # @font-face for every subset, wght axis
├── index.css / standard.css
└── metadata.json
```

Upstream canonical sources (citation / provenance): Source Serif 4 = Adobe Fonts (github.com/adobe-fonts/source-serif), republished via Google Fonts; Inter = github.com/rsms/inter; JetBrains Mono = github.com/JetBrains/JetBrainsMono. google-webfonts-helper (gwfh.mranftl.com) is an alternative for grabbing single-subset woff2 by hand, but fontsource is more stable/pinnable.

### 3. File sizes — Latin-subset variable `wght-normal` woff2 (exact, measured)

| Font | File | Size |
|---|---|---|
| Source Serif 4 | `source-serif-4-latin-wght-normal.woff2` | 50,824 B (~50 KB) |
| Inter | `inter-latin-wght-normal.woff2` | 48,256 B (~47 KB) |
| JetBrains Mono | `jetbrains-mono-latin-wght-normal.woff2` | 40,404 B (~39 KB) |
| **Total (3 files, normal only)** | | **139,484 B (~136 KB)** |

Notes:
- These are the `latin` subset (NOT `latin-ext`). If you also want `latin-ext` (Polish/Turkish/etc. accented chars), there are separate `*-latin-ext-wght-normal.woff2` files of similar size — adding all three latin-ext roughly doubles to ~270 KB. For an English/Chinese-reader app, `latin` alone is almost certainly enough (CJK is handled by system fonts per the fallback chain).
- Italic is a separate file per font (`*-latin-wght-italic.woff2`, ~42–52 KB each). Only bundle these if the theme needs true italics rather than synthesized obliques. For a reader UI, normal-only is usually fine; markdown `*emphasis*` can fall back to faux-italic.
- Total bundle impact is trivial (~136 KB) versus the existing CJK budget concern (Sarasa subset was ~1.5 MB). Fonts are NOT a bundle-size risk here.

### 4. `@font-face` snippet shape (variable font)

All three are genuine **variable fonts with a `wght` axis** (Source Serif 4 and JetBrains Mono also have `opsz`/`ital`; Inter has `opsz`/`ital`). Confirmed variable axes from `metadata.json`:

| Font | Variable axes | `wght` range (for `font-weight`) | fontsource family name |
|---|---|---|---|
| Source Serif 4 | `ital`, `opsz`, `wght` | **200 900** | `Source Serif 4 Variable` |
| Inter | `ital`, `opsz`, `wght` | **100 900** | `Inter Variable` |
| JetBrains Mono | `ital`, `wght` | **100 800** | `JetBrains Mono Variable` |

The generated fontsource `@font-face` uses `format('woff2-variations')` and a weight RANGE. Example shape (hand-written version pointing at our copied files):

```css
@font-face {
  font-family: 'Source Serif 4 Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 200 900;                 /* range = variable axis */
  src: url('../assets/fonts/source-serif-4-latin-wght-normal.woff2')
       format('woff2-variations');       /* see note below */
}

@font-face {
  font-family: 'Inter Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url('../assets/fonts/inter-latin-wght-normal.woff2') format('woff2-variations');
}

@font-face {
  font-family: 'JetBrains Mono Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 800;
  src: url('../assets/fonts/jetbrains-mono-latin-wght-normal.woff2') format('woff2-variations');
}
```

`format()` note: `format('woff2-variations')` is the spec-correct hint for a variable woff2 and is what fontsource emits. Modern browsers (incl. the WebView2/Chromium that Tauri uses on Windows) also accept plain `format('woff2')` for variable files — the existing `fonts.css` Sarasa rule uses `format('woff2')` with a `font-weight: 100 900` range and works. Either is fine; matching fontsource's `woff2-variations` is the more explicit choice. `font-display: swap` matches the existing convention and avoids invisible text while loading.

Important: the chosen `font-family` name in `@font-face` must match what `theme/claude.user.css` references. fontsource appends "Variable" to the family (e.g. `Inter Variable`, not `Inter`). Either declare the faces under those exact names and update the theme stacks to match, OR rename the `font-family` in the hand-written `@font-face` to the plain name (`Inter`, `Source Serif 4`, `JetBrains Mono`) so the theme's first-choice family resolves. (Plain names are cleaner for the theme stacks; renaming in your own `@font-face` is allowed.)

### 5. Recommendation for vendoring into this Vite frontend

Two options; the existing repo already commits to the manual pattern.

**Option A — `import '@fontsource-variable/<font>'` in `main.tsx` (NOT recommended here).**
- Pros: zero hand-written `@font-face`; auto-updates on `pnpm up`.
- Cons: the package's `index.css` (or even `wght.css`) declares `@font-face` for **every subset**: Source Serif 4 ships 36 woff2, Inter 42, JetBrains Mono 12. Importing the default CSS pulls cyrillic/greek/vietnamese subsets we don't want into `dist/assets/` (Vite emits referenced url()s). You'd have to import only the specific per-subset CSS (e.g. fontsource's granular `@fontsource-variable/inter/wght.css` still references all subsets) — there's no clean "latin only" entry. Net: more files than needed.

**Option B — manual copy of the 3 latin woff2 + hand-written `@font-face` (RECOMMENDED).**
- Copy `source-serif-4-latin-wght-normal.woff2`, `inter-latin-wght-normal.woff2`, `jetbrains-mono-latin-wght-normal.woff2` into `src/assets/fonts/`.
- Also copy each package's `LICENSE` into `src/assets/fonts/` (e.g. `OFL-source-serif-4.txt`, etc.) to satisfy OFL.
- Add the 3 `@font-face` rules to `src/styles/fonts.css` (already imported in the app; same pattern as the existing Sarasa rule at lines 23–35). Vite rewrites the relative `url('../assets/fonts/*.woff2')` to a fingerprinted `/assets/*.woff2` at build time — served from `'self'`, satisfying the `font-src 'self'` CSP with **no CSP change, no Rust resource bundling** (exactly the PRD R5 requirement).
- Trade-off vs A: you pick exactly the files you ship (only latin, only normal) = smallest bundle (~136 KB) and no cyrillic/greek noise; the cost is the copy is manual and won't auto-update on dependency bumps. For a 3-file, license-stable asset set this is the right call.
- A one-time fetch helper (a `scripts/` node script that npm-installs the three packages to a temp dir and copies the latin woff2 + LICENSE) keeps it reproducible without committing fontsource as a runtime dependency — optional.

### Files Found (internal — existing pattern to mirror)

| File Path | Description |
|---|---|
| `src/styles/fonts.css` | Existing `@font-face` (Sarasa, `format('woff2')`, `font-weight: 100 900`, `font-display: swap`) + `--font-stack-body` / `--font-stack-code` CSS vars. Add the 3 new faces here. |
| `src/assets/fonts/` | Existing font asset dir (currently a zero-byte Sarasa placeholder + README). Drop the 3 woff2 + OFL license files here. |
| `src/assets/fonts/README.md` | Documents the manual subset/copy recipe (pyftsubset + Vite asset emission). Same workflow applies; the fontsource files are already subset, so no pyftsubset needed. |
| `src-tauri/tauri.conf.json:28` | CSP `font-src 'self' data:` — confirms frontend-bundled fonts resolve from `'self'` with no CSP change. |
| `theme/claude.user.css` | Theme font stacks reference family names; must match the `font-family` chosen in the new `@font-face` rules. |

### Related Specs

- No existing `.trellis/spec/**` doc governs font bundling (searched). The PRD for this task (`prd.md`) §R1, R5, R6 set the constraints (Latin variable woff2, frontend `'self'`, graceful degradation).

## Caveats / Not Found

- Versions are pinned to what the npm registry served on 2026-05-25 (Source Serif 4 5.2.9, Inter 5.2.8, JetBrains Mono 5.2.8). fontsource bumps patch versions frequently; the latin `wght-normal` filenames have been stable across v5, but re-verify the filename if you bump.
- `format('woff2-variations')` vs `format('woff2')`: both work in Tauri's Chromium WebView; not separately smoke-tested in the built artifact here (the PRD already mandates a built-artifact smoke test per the project's CSP/WASM release gotcha).
- Italic + `latin-ext` files exist but are intentionally excluded from the size estimate / recommendation; include them only if the theme demands true italics or extended-Latin coverage.
- exa / context7 MCP tools advertised in the prompt were NOT available in this environment; sourcing was done directly against the npm registry (authoritative for package names/versions/contents) and the local repo, which is stronger evidence than web prose for the file-level facts (sizes, axes, bundled LICENSE).
