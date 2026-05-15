# Markdown Reader v0.1 — Tauri + React desktop app with interactive Mermaid

## Goal

Build a Windows desktop Markdown reader **for personal use** (single user: hbw)
whose differentiator is a **first-class Mermaid viewing experience** —
diagrams can be panned, zoomed, and opened full-screen, instead of being
rendered as fixed images you cannot interact with (the universal failure
mode of every Markdown reader the user has tried before).

Beyond Mermaid, the app should be a polished, GitHub-style single-file
viewer with the conveniences of a modern document app: drag-and-drop,
file association, in-document search, recent files, dark mode, scroll
memory, and printing.

## Background

Decisions in this PRD come from a 14-round design interview (`grill-me`
session, 2026-05-15). Where the user explicitly overrode the recommended
default, this is called out in **Decision (ADR-lite)** below.

---

## Requirements

### R1. Platform & Distribution

* **R1.1** Desktop application built with Tauri 2 (WebView2 on Windows).
* **R1.2** Distribution: MSI installer.
* **R1.3** **Portable layout**: data directory MUST live next to the
  executable (`<install_dir>/data/`), NOT in `AppData/Roaming/`.
* **R1.4** Installer MUST require the user to choose an install path
  explicitly — no default `C:\Program Files\` prefilled. The chosen path
  must be writable (rule out Program Files implicitly).
* **R1.5** No code signing. SmartScreen warning on first run is acceptable.
* **R1.6** No auto-update mechanism.

### R2. File Open & Window Model

* **R2.1** Single-file viewer. No tabs.
* **R2.2** Single-instance application. Opening a second `.md` while the app
  is running brings the existing window forward and replaces its content.
* **R2.3** Four equally-supported open paths:
  1. Double-click `.md` (Windows file association)
  2. Drag-and-drop file onto the app window
  3. `Ctrl+O` → native open dialog
  4. CLI argument: `markdown-reader path/to/file.md`
* **R2.4** Recent files: store last 10 (LRU, deduped) in
  `<install_dir>/data/recent.json`. Shown on the empty-state screen.
* **R2.5** Empty state (no file open): centered logo + hint text
  ("拖拽 .md 文件到此处 / Ctrl+O 打开") + recent-list. No onboarding modal.
* **R2.6** External-modification handling: when the file changes on disk,
  silently reload and **preserve scroll position**.
* **R2.7** Drag-drop of a non-`.md` file: show a toast and reject.
* **R2.8** Window state persisted (position, size, maximized) and restored
  on launch. If the previous monitor is gone, fall back to primary.
* **R2.9** Single-instance dispatch: when a second launch occurs, forward
  the new file path to the running instance and exit the new process.

### R3. Markdown Rendering

Pipeline: `react-markdown` + plugin chain.

* **R3.1** CommonMark + GFM (tables, task lists, strikethrough, autolinks).
* **R3.2** Math: `remark-math` + `rehype-katex`. Both inline `$x$` and
  block `$$x$$` supported.
* **R3.3** Code highlight: Shiki (`github-light` / `github-dark`).
* **R3.4** Footnotes (`[^1]`).
* **R3.5** Frontmatter (YAML): hidden by default; user can expand via a
  small icon at the top of the document.
* **R3.6** Auto-generated TOC + right-side collapsible TOC sidebar.
* **R3.7** Admonitions / callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`,
  `[!CAUTION]`, `[!IMPORTANT]`) styled GitHub-flavor.
* **R3.8** Mermaid (see R4).
* **R3.9** Task list checkboxes are **rendered but NOT clickable** —
  this is a reader, not an editor.
* **R3.10** Code blocks: top-right shows language label + Copy button;
  Copy click shows ✓ check for 1.5s then reverts.
* **R3.11** Code blocks default to **horizontal scroll** (configurable to
  word-wrap in v0.2 settings).

### R4. Mermaid (the differentiator)

* **R4.1** Mermaid library is **lazy-loaded** (`import('mermaid')`) only
  when a document contains a `mermaid` code block. First render shows a
  skeleton placeholder for ~200ms.
* **R4.2** Each rendered Mermaid SVG gets:
  * **Inline pan/zoom** via `svg-pan-zoom`:
    * Drag (left-button) = pan; cursor = `grab` / `grabbing`.
    * `Ctrl + wheel` on the diagram = zoom (regular wheel = page scroll —
      do NOT trap the page-scroll wheel on hover).
    * Double-click = reset to fit-to-width.
    * Zoom range 0.2× – 5×.
  * **Floating toolbar** (top-right of the diagram on hover): 4 buttons —
    Zoom-out, Zoom-in, Reset, Fullscreen.
  * Fullscreen button opens **Lightbox** (R5).
* **R4.3** Mermaid theme follows app theme (light → `default`, dark →
  `dark`). When the user toggles theme, all rendered Mermaid SVGs
  re-render to match.
* **R4.4** Render results are cached **in memory** keyed by source text +
  theme, so scrolling and theme toggles don't trigger expensive re-renders
  unnecessarily. No on-disk cache.
* **R4.5** A single Mermaid block with a syntax error renders as a red-
  bordered error placeholder with the error message. Other blocks in the
  document continue to render normally.
* **R4.6** Mermaid SVG content is NOT included in `Ctrl+F` search.

### R5. Lightbox (full-screen viewer)

* **R5.1** Triggered by:
  * Mermaid toolbar Fullscreen button.
  * Clicking any image (`<img>` rendered from markdown).
* **R5.2** Implementation: `panzoom` (anvaka). Same component handles both
  SVG (Mermaid) and raster images.
* **R5.3** Background overlay opacity ~90% (configurable in v0.2).
* **R5.4** Controls: drag to pan, wheel to zoom (no Ctrl needed inside
  lightbox), double-click to reset.
* **R5.5** Close: `Esc` or click outside the content.
* **R5.6** Lightbox state is NOT persisted.

### R6. Image Handling

* **R6.1** Local relative paths (`![](images/foo.png)`): resolved against
  the current document's directory and converted via Tauri's
  `convertFileSrc` to `asset://` for the WebView.
* **R6.2** Local absolute paths (`![](C:/x/foo.png)`): same conversion.
* **R6.3** HTTP/HTTPS images (`![](https://...)`): allowed via CSP
  `img-src https:`.
* **R6.4** Images are lazy-loaded via `IntersectionObserver`.
* **R6.5** Failed image loads show a gray placeholder containing the
  image's filename / URL.
* **R6.6** Image `alt` text shown as native `title` tooltip on hover.
* **R6.7** Right-click image → context menu: "Copy image", "Save as…",
  "Open in system viewer". (Using Tauri's clipboard + dialog APIs.)

### R7. Links

* **R7.1** External (`http`, `https`): open in **system default browser**
  via `shell.open`. Never inside a WebView.
* **R7.2** Local `.md` links (`[next](other.md)`): resolved against the
  current document's directory and **opened in the current window**
  (overwrite). Resolved file is added to recent list. **No path-scope
  restriction** — any path the user authored is trusted.
* **R7.3** Other local files (`[pdf](spec.pdf)`, `[img](pic.png)`): open
  with the system default application via `shell.open`.
* **R7.4** Anchor links (`[top](#heading)`): smooth-scroll within the
  current document.
* **R7.5** `mailto:`, `tel:`, etc.: handed to system default.
* **R7.6** Link hover: show full URL in a status bar at the bottom of the
  window (anti-phishing + clarity).
* **R7.7** Right-click link → context menu: "Copy link address",
  "Open in browser".
* **R7.8** Failed local-file open: toast error.
* **R7.9** **Back/forward navigation history** (Alt+← / Alt+→) is a
  v0.2 feature, not part of v0.1.

### R8. Search (in-document)

* **R8.1** Trigger: `Ctrl+F`. Search bar floats top-right, overlaying the
  content.
* **R8.2** All matches highlighted with yellow background; the current
  match additionally highlighted with orange.
* **R8.3** `Enter` / `F3` → next match; `Shift+Enter` / `Shift+F3` → prev.
* **R8.4** Each navigation auto-scrolls the current match to view-center.
* **R8.5** Counter shows `<current> / <total>`. When zero, show in red.
* **R8.6** `Esc` closes the bar AND clears highlights.
* **R8.7** Toggles in the bar: `Aa` case-sensitive, `""` whole-word, `.*`
  regex.
* **R8.8** Search includes regular text and code-block content.
* **R8.9** Search excludes Mermaid SVG content and KaTeX-rendered formulas.
* **R8.10** Frontmatter is searched only when the user has expanded it.
* **R8.11** Search term is remembered within the current session
  (re-opening the bar pre-selects the previous term) but NOT across
  app restarts.

### R9. Theme & Typography

* **R9.1** Three theme modes: Light, Dark, Follow-System (default).
* **R9.2** Theme switching has a **200ms color/background fade transition**
  (user override of the recommended "instant").
* **R9.3** Body styling based on `github-markdown-css` with custom overrides.
* **R9.4** Body max-width: 820px, horizontally centered.
* **R9.5** Bundled CJK font: **Sarasa UI SC** as a subsetted woff2
  (~1.5 MB, common GB2312 + extended GBK characters). Fallback to system
  `"PingFang SC", "Microsoft YaHei"` for missing glyphs.
* **R9.6** Code font stack: `"JetBrains Mono", "Cascadia Code", Consolas,
  monospace`.
* **R9.7** Base font size: 16px body / 14px code.
* **R9.8** Line-height: 1.7 body / 1.5 code.
* **R9.9** Headings: h1/h2 get GitHub-style underline rule.
* **R9.10** **Frameless window** with custom Win11-style titlebar (drag
  region, minimize/maximize/close buttons, theme-aware coloring).
* **R9.11** **`user.css`** loaded from `<install_dir>/data/user.css` if
  present, after default styles, allowing the user to override anything.

### R10. State Persistence

All persisted under `<install_dir>/data/`.

* **R10.1** `window.json` — position (x, y), size (w, h), maximized.
* **R10.2** `settings.json` — theme mode, page zoom, TOC visibility,
  font preferences (when GUI panel ships in v0.2; v0.1 reads sensible
  defaults plus what the menu can change).
* **R10.3** `recent.json` — last 10 absolute paths, LRU.
* **R10.4** `scroll-positions.json` — map of `{absolute_path → pixel_y}`,
  LRU-bounded to 100 entries. Restored on file-open. Stored as **pixel
  offset**.
* **R10.5** Page-level zoom (`Ctrl+=`/`Ctrl+-`/`Ctrl+0`): persisted,
  range 50% – 200%, step 10%.
* **R10.6** Mermaid pan/zoom state, lightbox state, search term: NOT
  persisted across sessions.
* **R10.7** **App does NOT auto-restore the last-opened file on launch**
  (always starts at empty state with the recent-list).
* **R10.8** Corrupt persistence files (e.g., malformed JSON): silently
  reset to empty + `console.warn`.
* **R10.9** Logs: `<install_dir>/data/logs/app.log`, max 5MB rolling, kept
  for 7 days.

### R11. Printing

* **R11.1** `Ctrl+P` invokes the native system print dialog (which on
  Windows allows "Save as PDF"). No custom export-PDF command.
* **R11.2** Print stylesheet **forces Light theme** regardless of current.
* **R11.3** Hide during print: TOC sidebar, search bar, custom titlebar,
  Lightbox, Mermaid hover toolbar.
* **R11.4** Mermaid prints as a static SVG **fit to the print page width**
  (no overflow into next page).
* **R11.5** Code blocks **force word-wrap** during print (otherwise long
  lines get clipped).
* **R11.6** Links print with the URL alongside the link text:
  `link text (https://example.com)` (GitHub-style).

### R12. Error Handling & Logging

* **R12.1** Markdown parse failure: render raw text in the body + top toast
  "解析异常".
* **R12.2** Single Mermaid syntax error: red-bordered fallback (R4.5).
* **R12.3** Single KaTeX formula syntax error: red fallback inline.
* **R12.4** Image load failure: gray placeholder (R6.5).
* **R12.5** File read failure: toast with friendly message.
* **R12.6** React tree crash: ErrorBoundary shows "出错了" + "Reload".
* **R12.7** Logging: rolling file as in R10.9. Console mirrors in dev.
* **R12.8** Toasts show a one-line user-friendly message; a "Details"
  button expands the full stack trace.
* **R12.9** No crash reporting / telemetry.

### R13. Keyboard Shortcuts (v0.1 set)

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open file dialog |
| `Ctrl+W` | Close current file (return to empty state) |
| `Ctrl+Q` | Quit app |
| `Ctrl+F` | Open search bar |
| `Enter` / `F3` | Next match |
| `Shift+Enter` / `Shift+F3` | Previous match |
| `Esc` | Close search / Close lightbox |
| `Ctrl+P` | Print |
| `Ctrl+=` | Page zoom in 10% |
| `Ctrl+-` | Page zoom out 10% |
| `Ctrl+0` | Page zoom reset 100% |
| `Ctrl+R` / `F5` | Reload current file |
| `Ctrl+\` | Toggle TOC sidebar |
| `Ctrl+T` | Cycle theme (light → dark → system) |
| `F11` | Toggle fullscreen window |
| `Ctrl+Wheel` (on diagram/image) | Zoom diagram/image |
| `Ctrl+Wheel` (elsewhere) | Page zoom |

Shortcuts are NOT user-rebindable in v0.1.

### R14. Misc UX Details

* **R14.1** Code block "Copy" success state: ✓ for 1.5s, then revert.
* **R14.2** TOC: clicking an entry smooth-scrolls to the heading.
* **R14.3** TOC: highlights the current section as the user scrolls
  (`IntersectionObserver`).
* **R14.4** TOC: NO collapsible sub-headings in v0.1.
* **R14.5** Mermaid + Image right-click → "Copy as image" to clipboard.
* **R14.6** Frontmatter: small icon at document top toggles
  expand/collapse.
* **R14.7** All UI strings are Chinese (no i18n framework in v0.1).

---

## Acceptance Criteria

### File open
* [ ] Double-click a `.md` file in Explorer → opens in the app (file
      association registered by the installer).
* [ ] Dragging a `.md` file onto the open window replaces the content.
* [ ] `Ctrl+O` opens the native dialog.
* [ ] Running `markdown-reader path\to\file.md` from a terminal opens it.
* [ ] Dragging a non-`.md` file shows a toast and ignores the drop.
* [ ] When the app is already open, double-clicking a different `.md`
      brings the window forward and replaces content (no second instance).

### Mermaid (core differentiator)
* [ ] A document with one or more Mermaid blocks renders them
      interactively.
* [ ] Hovering a Mermaid diagram shows a 4-button toolbar.
* [ ] `Ctrl+Wheel` on a Mermaid diagram zooms it within 0.2×–5×.
* [ ] Plain wheel on a Mermaid diagram scrolls the page (does not zoom).
* [ ] Drag-pan works inside a Mermaid diagram.
* [ ] Double-click resets the diagram to fit-to-width.
* [ ] Clicking the Fullscreen toolbar button opens the diagram in a
      lightbox; `Esc` closes it.
* [ ] Lightbox supports drag-pan + wheel-zoom + double-click-reset.
* [ ] An invalid Mermaid block shows a red error placeholder; other
      blocks still render.
* [ ] Switching theme re-renders Mermaid in matching colors.

### Markdown
* [ ] GFM tables, task lists, strikethrough, autolinks render correctly.
* [ ] Math (inline `$...$` and block `$$...$$`) renders via KaTeX.
* [ ] Code blocks have Shiki syntax highlight matching the active theme.
* [ ] Code blocks have language label + Copy button (✓ flash on copy).
* [ ] Footnotes link forward and back.
* [ ] YAML frontmatter is hidden by default; toggleable via icon.
* [ ] Admonitions (`> [!NOTE]` etc.) render with GitHub-style boxes.

### Images
* [ ] `![](images/foo.png)` next to the .md loads via `convertFileSrc`.
* [ ] HTTP image URL loads.
* [ ] Failed image shows gray placeholder with filename/URL.
* [ ] Click an image → opens lightbox.

### Links
* [ ] `https://...` link opens the system default browser.
* [ ] Local `.md` link opens in the current window.
* [ ] Local `.pdf` link opens with the system default app.
* [ ] Anchor link smooth-scrolls within the document.
* [ ] Status bar at the bottom shows the full URL on hover.

### Search
* [ ] `Ctrl+F` opens search bar; all matches highlight yellow, current
      match orange.
* [ ] `Enter` / `Shift+Enter` cycle matches; counter updates.
* [ ] Case-sensitive / whole-word / regex toggles work.
* [ ] `Esc` clears highlights and closes the bar.
* [ ] Mermaid SVG and KaTeX content are excluded from search.

### Theme & typography
* [ ] System theme change while app is open switches mode automatically
      (when set to "Follow system").
* [ ] Theme transition animates over ~200ms.
* [ ] Body width caps at 820px on wide screens.
* [ ] Sarasa UI SC font is rendered (verify via DevTools `font-family`).
* [ ] Custom titlebar matches Win11 control sizes; window is draggable
      via the titlebar; min/max/close buttons function.
* [ ] `<install_dir>/data/user.css` (when present) overrides default
      styles after default load.

### State persistence
* [ ] App relaunch restores window position, size, maximized state.
* [ ] Re-opening a previously-viewed file restores scroll position.
* [ ] Recent list shows the 10 most-recent files.
* [ ] Theme + page zoom + TOC visibility persist across launches.
* [ ] Launch always starts at empty state (does NOT auto-open last file).
* [ ] Corrupting a persistence JSON file does not crash the app.

### Print
* [ ] `Ctrl+P` opens system print dialog.
* [ ] Print preview hides TOC, search bar, titlebar, Mermaid toolbar.
* [ ] Print uses Light theme even if app is in Dark.
* [ ] Long code lines wrap in print preview (no clipping).
* [ ] Links print with their URL appended in parentheses.

### Distribution
* [ ] MSI installer asks the user for an install path; no Program Files
      default prefilled.
* [ ] After install, `<install_dir>/` contains both the executable and
      a `data/` subdirectory (created on first launch if absent).
* [ ] File association is registered for `.md`.
* [ ] App size on disk: target < 30 MB (Tauri norm).

### Robustness
* [ ] Opening a 5MB+ markdown file does not freeze the UI > 1s.
* [ ] React error boundary catches a forced render error and shows the
      reload UI.
* [ ] Killing the app mid-write of `recent.json` does not corrupt next
      launch (atomic write or graceful recovery).

---

## Definition of Done

* All acceptance criteria checked.
* `npm run build` (frontend) and `cargo build --release` (Tauri) succeed.
* `npm run tauri build` produces a working MSI on Windows 11.
* Type-check (`tsc --noEmit`) clean.
* Lint (ESLint) clean.
* Manual smoke test passing on a real Win11 machine: install via MSI →
  associate → double-click a real-world `.md` (with mermaid + math + code
  + images) → exercise pan/zoom + lightbox + search + theme toggle +
  print preview.
* README documents install / usage / data location.
* Git tag `v0.1.0` cut from `main`; MSI uploaded as a GitHub Release
  asset.

---

## Technical Approach

### Project layout

```
markdown_reader/
├── package.json                # Vite + React + TS workspace
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/                        # React app
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Titlebar/           # Frameless Win11 titlebar
│   │   ├── EmptyState/         # Logo + recent list
│   │   ├── DocumentView/       # react-markdown + plugins
│   │   ├── Mermaid/            # lazy-load mermaid + svg-pan-zoom
│   │   ├── Lightbox/           # panzoom-based fullscreen
│   │   ├── SearchBar/          # Ctrl+F overlay
│   │   ├── Toc/                # right-side TOC sidebar
│   │   ├── ContextMenu/        # right-click menus
│   │   └── Toast/              # error/info toasts
│   ├── hooks/
│   │   ├── useTheme.ts
│   │   ├── useFileWatcher.ts
│   │   ├── useScrollMemory.ts
│   │   ├── useShortcuts.ts
│   │   └── useRecentFiles.ts
│   ├── lib/
│   │   ├── markdownPlugins.ts  # Plugin chain config
│   │   ├── mermaidLazy.ts      # Dynamic import wrapper
│   │   ├── tauri.ts            # Wrapper around @tauri-apps/api
│   │   └── persistence.ts      # JSON load/save w/ atomic write
│   ├── styles/
│   │   ├── github-markdown.css
│   │   ├── katex.min.css
│   │   ├── theme.light.css
│   │   ├── theme.dark.css
│   │   └── titlebar.css
│   └── assets/
│       └── fonts/
│           └── sarasa-ui-sc-subset.woff2
├── src-tauri/                  # Tauri Rust shell
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   └── src/
│       ├── main.rs
│       ├── single_instance.rs  # tauri-plugin-single-instance
│       ├── file_watcher.rs     # notify crate
│       ├── encoding.rs         # chardetng (v0.2)
│       └── data_dir.rs         # portable: dir of current_exe()
└── .trellis/                   # already exists
```

### Data directory resolution (portable)

In Tauri, override the default `BaseDirectory.AppData` with a custom
function that returns `current_exe().parent() / "data"`. Create the
directory on first launch if absent. All persistence (R10) reads/writes
relative to this.

### Single instance

Use `tauri-plugin-single-instance`. Second-launch handler receives the
file path argv, sends an event to the running window, which loads the
new file and brings itself to front.

### File watcher

`notify` crate watching the currently-open file. On modification event,
debounce 200ms, then re-read and emit to the frontend; frontend re-renders
preserving scroll-Y.

### Mermaid lazy load

```ts
// src/lib/mermaidLazy.ts
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;
export const loadMermaid = () => {
  if (!mermaidPromise) mermaidPromise = import('mermaid');
  return mermaidPromise;
};
```

`<Mermaid>` component awaits this when first mounted in any document.

### Mermaid render cache

In-memory `Map<sourceText + theme, SVG string>`. Cleared on
`window.beforeunload`. Theme toggle invalidates by re-keying.

### svg-pan-zoom integration

After Mermaid produces the SVG and inserts it into the DOM, attach
`svgPanZoom(element, { minZoom: 0.2, maxZoom: 5, contain: false,
fit: true, center: true, zoomScaleSensitivity: 0.4 })`. Wrap the wheel
handler so it only zooms when `ctrlKey` is true; otherwise stop the
SVG zoom and let the page scroll naturally.

### Lightbox

A portal-rendered overlay component with `panzoom` attached to a wrapper
that contains either a cloned Mermaid SVG or an `<img>`. ESC + outside-
click handlers for dismissal.

### Theme

CSS variables per theme. `useTheme` listens to
`window.matchMedia('(prefers-color-scheme: dark)')` when in
"Follow system" mode. Theme change triggers Mermaid re-render via the
cache invalidation.

### user.css load

On startup, attempt `readTextFile(<data>/user.css)`. If exists, inject
as a `<style>` element appended last in `<head>` so it wins specificity
ties.

### Image relative-path resolution

A `rehype` plugin walks `<img>` nodes, takes the `src`, resolves against
`path.dirname(currentDocPath)`, and rewrites to `convertFileSrc(absPath)`.
HTTP URLs pass through. CSP allows `asset:` and `https:` for `img-src`.

### Search highlighting

DOM walk after render: find all text nodes inside `.markdown-body` (skip
`.mermaid` and `.katex` subtrees), wrap matches in `<mark>` with `data-
match-index`. Navigation updates a class on current match. Cleared on
close by removing all `<mark>` wrappers.

### Print

CSS `@media print` rules hide UI chrome, force light theme variables,
add link-URL via `a[href^='http']::after { content: " (" attr(href) ")"; }`.

### MSI installer

Tauri's WiX bundler. Configure `tauri.conf.json` → `bundle.windows.wix`:
* `template`: custom WXS that omits the default `INSTALLDIR` set to
  Program Files; instead expose a UI step asking user to pick a folder.
* Register `.md` file association.
* Place no shortcuts other than Start Menu (skip Desktop by default).

---

## Decision (ADR-lite)

Recorded user-driven overrides of recommended defaults during the
14-round design session. (Where the recommendation was accepted, no
record needed — see Requirements above.)

| # | Topic | Default proposed | User chose | Why it matters |
|---|---|---|---|---|
| D1 | Theme transition | No animation (instant) | **200ms fade** | User finds animation more polished; cost is minimal |
| D2 | Window decoration | Native Windows titlebar | **Frameless + custom Win11 titlebar** | Wants the modern app look; adds drag region and control implementation work |
| D3 | Settings UI | Minimal menu + JSON only (faster) | **Full GUI settings panel** | User wants discoverability; we DEFER GUI to v0.2, keep menu+JSON for v0.1 |
| D4 | Install path | Default `C:\Program Files\` prefilled | **No default — installer must require user choice** | Required because data dir is portable (next-to-exe); install path must be writable |
| D5 | Data directory | `AppData/Roaming/markdown-reader/` | **`<install_dir>/data/`** | True portable mode; uninstalling the install dir cleanly removes everything; user can put on any disk |

---

## Out of Scope (v0.1)

These are deferred to **v0.2** explicitly:

* **Full GUI Settings Panel** (left-nav + sectioned form,即改即生效, import/
  export, "reset all"). v0.1 ships menu items for theme/zoom/TOC and uses
  `<data>/settings.json` for everything else.
* **Quick Open** (`Ctrl+Shift+P`) listing same-directory `.md` files.
* **Back/forward navigation history** (`Alt+←` / `Alt+→`).
* **`chardetng` encoding auto-detection** — v0.1 reads as UTF-8 only.
* **5MB+ large-file warning prompt**.
* **`user.css` hot-reload** — v0.1 loads user.css once at startup;
  changes require app restart.
* **Per-file remember-Mermaid-zoom-state** — explicitly out of scope.
* **Multi-tab** — explicitly out of scope (probably forever).
* **Editor mode** — explicitly out of scope (this is a reader).
* **Live editing of task list checkboxes** — explicitly out of scope.
* **PlantUML / Graphviz / D2 diagrams** — only Mermaid.
* **Wiki-link `[[xxx]]`** — single-file scope makes this meaningless.
* **i18n** — Chinese-only UI in v0.1.
* **Rebindable shortcuts**.
* **Auto-update** / signed binaries / telemetry.
* **macOS / Linux builds** — Windows only for v0.1.

---

## Implementation Plan (suggested PR slices)

To keep PRs reviewable, propose the following slices. Each PR ends with
the app still launching and the prior slice's behavior intact.

* **PR-1: Scaffolding & frameless shell**
  Tauri 2 + React + Vite project, frameless window with Win11-style
  titlebar (drag region + min/max/close), data-dir-portable plumbing,
  `Ctrl+O` open dialog, single-instance plugin, empty state UI.
  Acceptance: app installs, opens, closes; titlebar works.

* **PR-2: Markdown rendering core**
  `react-markdown` + GFM + frontmatter (collapsed) + footnote +
  Shiki + KaTeX + admonition. Code-block copy button. GitHub-CSS
  styling. No Mermaid yet.
  Acceptance: a sample doc with all markdown features renders correctly.

* **PR-3: Mermaid (the differentiator)**
  Lazy load + render cache + svg-pan-zoom inline (Ctrl+wheel zoom +
  drag pan + double-click reset + zoom range) + floating toolbar.
  Acceptance: AC §"Mermaid (core differentiator)" all green except
  fullscreen-related (deferred to PR-4).

* **PR-4: Lightbox (Mermaid fullscreen + image click)**
  Portal lightbox with `panzoom`, ESC close, dispatch from Mermaid
  toolbar Fullscreen and from any image click.
  Acceptance: AC §Mermaid fullscreen items + AC §Images click-to-
  lightbox green.

* **PR-5: File operations & state persistence**
  Drag-and-drop, file association registration in MSI, recent list,
  scroll memory, window state, file-watcher auto-reload, link
  navigation rules (R7), image path resolution (R6).
  Acceptance: AC §File open + §State persistence + §Links + §Images
  green.

* **PR-6: Theme system + bundled fonts**
  Light/Dark/Follow-system with 200ms fade, Sarasa UI SC subset woff2,
  Mermaid theme follow-app, `user.css` load.
  Acceptance: AC §"Theme & typography" green.

* **PR-7: Search + TOC**
  Ctrl+F overlay with highlight + counter + nav + toggles. Right-side
  TOC with current-section highlight + smooth scroll.
  Acceptance: AC §Search green; TOC visible & functional.

* **PR-8: Print + error handling polish + status bar**
  `@media print` rules, ErrorBoundary, toast system, status bar URL
  hover, context menus, logging.
  Acceptance: AC §Print + §Robustness + remaining items green.

* **PR-9: Build & release**
  WiX template tweaks (no default install dir, file association),
  README finalize, version 0.1.0, GitHub Release with MSI asset.
  Acceptance: install MSI on a fresh Win11 → all AC pass.

---

## Technical Notes

* **WebView2 quirk**: `convertFileSrc` returns `https://asset.localhost/...`
  on Windows — verify CSP allows it.
* **Mermaid bundle size**: ~4MB minified — that's why R4.1 mandates lazy
  load; otherwise cold start suffers.
* **Sarasa UI SC subset**: use `pyftsubset` or `glyphhanger` to produce
  a CJK-common subset (~7000 chars) under 1.5MB; full font is ~20MB and
  unacceptable for distribution.
* **MSI custom path**: WiX `INSTALLFOLDER` UI dialog requires writing a
  custom WXS template; reference Tauri's
  [`tauri.conf.json` bundle.windows.wix.template`](https://tauri.app/v2/reference/config/#wixconfig).
* **Single-instance with file path**: `tauri-plugin-single-instance` 2.x
  receives `argv` array in the secondary-launch callback — the second
  argv element is the path passed to the new exe.
* **File watcher debouncing**: editors save in two stages
  (write-temp → atomic-rename), which produces multiple `notify` events;
  200ms debounce prevents double-render flicker.
* **Search inside Shiki output**: Shiki renders code as nested `<span>` —
  the text-node walk handles this naturally (search aggregates across
  spans by walking the text tree, not by HTML matching).
* **Lightbox SVG cloning**: when opening Mermaid fullscreen, clone the
  SVG node (don't move it) so the inline diagram remains in place when
  the lightbox closes.

---

## Open Questions

None blocking implementation. Items deferred to v0.2 are listed in
"Out of Scope" above.
