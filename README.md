# markdown-reader

A desktop Markdown reader focused on a great Mermaid viewing experience —
diagrams can be panned, zoomed, and opened full-screen, instead of being
rendered as fixed images you cannot interact with.

## Status

Pre-development. Project scope and tech stack agreed; v0.1 implementation
about to start. See `.trellis/tasks/` for the active task and PRD.

## Tech Stack

- **Shell**: Tauri 2 (Windows MSI, portable data dir)
- **Frontend**: React 18 + TypeScript + Vite
- **Markdown**: react-markdown + remark-gfm + remark-math + rehype-katex
  + Shiki + Mermaid + remark-frontmatter + remark-toc + admonition
- **Pan/Zoom**: svg-pan-zoom (inline SVG) + panzoom (lightbox / images)

## Highlights

- Single-file viewer with file association, drag-and-drop, recent list
- In-document `Ctrl+F` search with all-match highlighting
- Light / Dark / system theme with smooth transition
- GitHub-style typography, bundled CJK woff2 (Sarasa UI SC subset)
- Frameless window with custom Win11-style titlebar
- Inline Mermaid pan/zoom + click-to-fullscreen lightbox
- Auto-reload on external file changes, per-file scroll memory
- Portable mode: data lives next to the executable

## Personal Project

Built for personal use; no auto-update, no telemetry, no signing.

## License

TBD
