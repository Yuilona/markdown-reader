# Claude theme: bundle fonts + first-run auto-apply

## Goal

Make the bundled Claude "Quiet Serif" theme the out-of-box experience: ship three
open-licensed fonts (Source Serif 4 / Inter / JetBrains Mono) inside the app and load
them via `@font-face` (no system install), and on first run write the Claude theme to
`data/user.css` and enable it — so a fresh install looks like Claude with zero user setup,
while still degrading gracefully and respecting any user-authored `user.css`.

## What I already know

- `user.css` is loaded ONCE on app mount by `src/lib/userCss.ts::loadUserCss()` — reads
  `<dataDir>/user.css` (path from Rust `get_data_dir`), injects as a `<style>` appended
  LAST in `<head>` (wins specificity ties, no `!important` needed). Missing file = silent no-op.
- Data dir is writable; capabilities already grant `fs:allow-write-text-file` / `exists` /
  `rename` / `remove` to `**` (src-tauri/capabilities/default.json) → no capability change.
- `theme/claude.user.css` is the existing theme. Font stacks today (lines 33-35):
  - `--claude-serif: "Anthropic Serif Web Text", Georgia, "Times New Roman", "Noto Serif SC", serif`
  - `--claude-sans: "Anthropic Sans Web Text", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
  - `--claude-mono: "Anthropic Mono Variable", ui-monospace, "Cascadia Code", Consolas, monospace`
  - The Anthropic fonts are PROPRIETARY (claude.ai web fonts) → NOT redistributable. Replace
    the first-choice with the bundled open fonts; keep the rest of the fallback chain.
- CSP is `font-src 'self' data:` (tauri.conf.json). If fonts are bundled into the FRONTEND
  (Vite `src/assets/fonts/`, emitted to `dist/assets/`), they're served from `'self'` →
  **no CSP change, no Rust resource bundling**.
- App already writes JSON to the data dir atomically (recent.json / scroll-positions.json /
  settings.json), so a first-run write of `user.css` fits existing patterns.

## Assumptions (temporary)

- @font-face lives in a NEW app-bundled stylesheet (e.g. `src/styles/fonts.css`) imported by
  `main.tsx`, NOT inside user.css. The theme file only references family names. Benefit:
  fonts available regardless of which theme is active; a hand-copied `theme/claude.user.css`
  also picks them up inside this app; declaring @font-face is free until a rule actually uses
  the family (browsers lazy-download woff2).
- Bundle Latin-subset variable woff2 only. CJK is NOT bundled (too large) → falls back to
  system (Noto Serif SC / Microsoft YaHei) via the existing fallback chain.
- Theme content seeded into user.css = `theme/claude.user.css`, imported into the JS bundle as
  raw text (Vite `?raw`) so it's available at runtime without Rust resource bundling.

## Open Questions

- (resolved) First-run seeding semantics → Option A (broadest). See Decision (ADR-lite).

## Requirements (evolving)

- R1. Bundle FOUR fonts in the frontend; declare `@font-face` in app-bundled CSS:
  - Source Serif 4 (en serif), Inter (sans), JetBrains Mono (mono) — Latin-subset variable woff2.
  - **Noto Serif SC (CJK serif body)** — subset woff2 (~common GB2312/GBK + Latin + punctuation,
    weights 400+700 or variable). Source TTFs already present locally at
    `theme/主题V14.0/中文衬线体（全选安装即可）/NotoSerifSC-*.ttf` → subset with pyftsubset.
    This is the theme's true Chinese body face (the original Typora theme ships it for install).
- R1b. The original theme's logo fonts (站酷小薇LOGO体 / UnifrakturMaguntia, in 根目录书信体/) are
  Typora-sidebar-logo only — NOT bundled, not referenced (our app has no such element).
- R2. Update `theme/claude.user.css` font stacks to a 3-tier chain: keep the proprietary
  Anthropic family name FIRST (used only if the user happens to have it installed — naming is
  not distribution, no licensing issue), then the bundled open family, then Georgia / system /
  CJK fallbacks. Resulting chains:
  - serif: `"Anthropic Serif Web Text", "Source Serif 4", Georgia, "Times New Roman", "Noto Serif SC", serif`
  - sans: `"Anthropic Sans Web Text", "Inter", system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
  - mono: `"Anthropic Mono Variable", "JetBrains Mono", ui-monospace, "Cascadia Code", Consolas, monospace`
  - NOTE: `"Noto Serif SC"` already sits in the serif chain as the CJK fallback — bundling it
    (R1) makes that name actually resolve out-of-box. Anthropic family names confirmed exact
    (from the shipped TTF name tables): `Anthropic Serif Web Text` / `Anthropic Sans Web Text` /
    `Anthropic Mono Variable`.
- R3. First-run: if `data/user.css` does NOT exist AND not previously seeded, write the Claude
  theme to `data/user.css`, then load+inject it (same session, no restart needed).
- R4. Respect user intent: never overwrite an existing `user.css`; never re-seed after the user
  deletes it (sentinel marker records "already seeded once").
- R5. No CSP change, no capability change, no Rust resource bundling (fonts via frontend 'self').
- R6. Graceful degradation: theme still renders with system fonts if woff2 fail to load.

## Acceptance Criteria

- [x] `data/user.css` created on first run with the Claude theme content — covered by unit test
  (`src/lib/userCss.test.ts` "seeds the Claude theme + sentinel…").
- [x] Deleting `data/user.css` + relaunch → no re-seed — unit test ("does NOT re-seed when … sentinel exists").
- [x] A user-authored `data/user.css` is never overwritten — unit test ("loads an existing user.css … never overwrites").
- [x] Bundled fonts emitted to `dist/assets/` from app origin (verified in build output: 4 woff2,
  noto-serif-sc ≈ 8.4 MB) — CSP `font-src 'self'` already covers; no CSP/Rust/cap change.
- [x] tsc + vitest (29 tests) + vite build all green.
- [ ] RUNTIME (user smoke-test on the built artifact): fresh install first-launch shows Claude
  theme w/ Source Serif 4 (en) + Noto Serif SC (zh); no CSP violation in console; revert works.

## Definition of Done

- Tests added/updated for the first-run seeding logic (exists/seed/respect-deletion branches).
- Lint / typecheck / CI green.
- docs/theming.md + README updated (bundled fonts + first-run behavior + how to revert).
- Built artifact smoke-tested (CSP/WASM release gotcha — always verify the bundle).

## Out of Scope (explicit)

- Bundling CJK fonts (size); CJK keeps using system fonts.
- A settings-UI theme picker / toggle (revert = delete user.css; documented).
- Hot-reload of user.css (still restart-to-apply; unchanged).
- Bundling the proprietary Anthropic fonts (licensing).

## Decision (ADR-lite)

**Context**: Need a first-run trigger that makes Claude the default look while respecting a
user who deletes `user.css` to revert, and not clobbering a user-authored `user.css`.

**Decision**:
- Seeding trigger = **Option A (broadest)**: on mount, if `data/user.css` is ABSENT and the
  sentinel `data/.theme-seeded` is ABSENT → write the Claude theme to `data/user.css`, write
  the sentinel, then inject. Existing installs lacking user.css ARE flipped to Claude theme on
  their next launch (accepted — this is the desired "make it the default" behavior).
- The sentinel records "seeded once" so deleting `user.css` afterwards reverts to the plain
  default and is NOT resurrected on the next launch.
- An existing `user.css` is never overwritten (the absent-check guards it; the sentinel is also
  written in that case to avoid any later seeding).
- Fonts: vendor **Latin-subset variable woff2** (one `wght`-axis file per family) by copying
  into `src/assets/fonts/` + hand-written `@font-face` in `src/styles/fonts.css` (matches the
  existing Sarasa pattern; resolves at `'self'`; no CSP / Rust / capability change). Sources:
  `@fontsource-variable/source-serif-4` `inter` `jetbrains-mono` (all SIL OFL-1.1, ship the
  LICENSE). ~50 + 47 + 39 KB ≈ **136 KB** added. `JetBrains Mono` was already named in
  `--font-stack-code` (previously unbundled) — now actually bundled.

**Consequences**: New + existing-without-user.css installs both show Claude theme out of box.
Upgrade users on the plain default get visually flipped once (revert = delete user.css,
documented). +136 KB bundle. CJK still system-served (no CJK bundling).

## Technical Notes

- Loader to extend: `src/lib/userCss.ts` (add seed-if-absent before the read).
- Theme source import: `theme/claude.user.css?raw` (or move into `src/`).
- Font files: `src/assets/fonts/*.woff2` + `src/styles/fonts.css` `@font-face`, import in `main.tsx`.
- Release gotcha: keep `wasm-unsafe-eval` in CSP; smoke-test built artifact (project memory).

## Research References

- [`research/font-sourcing.md`](research/font-sourcing.md) — exact woff2 sources, license, variable-weight + Latin-subset sizes (pending sub-agent).
