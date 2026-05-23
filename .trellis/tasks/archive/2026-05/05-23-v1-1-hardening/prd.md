# v1.1 hardening: atomic save + tests + release CI

## Goal

把 v1.0 暴露出来的两类工程风险补上：(1) 用户文档保存不是原子写，崩溃可能损坏 `.md`；(2) 零测试 + 手工发版，导致两个「只在生产构建复现」的 bug（白屏 CSP、关不掉 allow-destroy）一路漏到 release。目标是降低数据丢失风险，并让「被测的就是要发的那个构建」。

## What I already know

- **保存路径**：`src/lib/tauri.ts` 的 `saveDocument(path, text)` / `saveAsDocument(text)` 直接 `writeTextFile(path, text)` —— 非原子。崩溃/断电中途写入会截断用户文件。
- **已有原子写模式**：`src/lib/persistJson.ts` 的 `atomicWriteJson` 用「写 `.tmp` → rename」。capabilities 已含 `fs:allow-write-text-file` / `fs:allow-rename` / `fs:allow-remove`（scope `**`）。可在 JS 侧复用同样模式做文本原子写，无需改 Rust。
- **测试现状**：无测试框架、无测试。项目是 Vite + React 18 + TS。
- **可测的纯逻辑**（优先）：
  - `lib/settings.ts` `validate` / `validateEditor` / `needsMigration`（migration 正确性）
  - frontmatter 行偏移：`lib/parseFrontmatter.ts` + DocumentView 里 `frontmatterRaw.split('\n').length + 2` 的换算
  - `lib/rehypeSourceLine.ts` 两遍打戳（含 Shiki Root 片段的 after-pass）
  - `components/EditModeProvider` 的 self-write race guard（保存中继续打字不被回写覆盖）—— 需要 React hook 测试
- **发版现状**：手工 `pnpm tauri build` + `gh release create`（本次 v1.0.0 即如此）。
- **CI 现状**：仓库无 `.github/workflows/`。
- **约束**：仅 Windows 目标；无代码签名证书；个人项目（CI 分钟数敏感）。

## Assumptions (temporary)

- 测试框架用 **Vitest**（与 Vite 同源、零额外配置成本）；React 部分用 `@testing-library/react`。
- CI 用 **GitHub Actions**；release 构建用官方 `tauri-apps/tauri-action`（标准做法，自动 build + 建 release + 传 artifact）。
- 原子保存走 **JS 侧 tmp+rename**（复用 persistJson 模式），不加 Rust 命令。

## Open Questions

见下方「Decision」表，待用户确认/否决。

## Requirements (evolving)

### R1 原子保存
- `saveDocument` / `saveAsDocument` 改为原子写：写入 `<path>.tmp` → rename 覆盖原文件。
- 失败时清理残留 `.tmp`，并保持原文件不被破坏；错误照常向上抛（toast）。
- 启动期 `cleanupStaleTemp` 兼容新产生的 `*.md.tmp`（或限定目录策略）。

### R2 测试
- 引入 Vitest（+ jsdom + @testing-library/react 视需要）。
- 覆盖：settings migration、frontmatter 偏移、rehypeSourceLine 两遍、EditModeProvider self-write race、原子保存的成功/失败路径。
- `package.json` 加 `test` script；CI 跑它。

### R3 发版 CI
- 轻量检查（push / PR）：`tsc --noEmit` + `vitest run` + `vite build`（不构建 Tauri，分钟数低）。
- 发版（push tag `v*`）：`tauri-action` 在 windows runner 上 `tauri build`，自动创建/更新 GitHub Release 并上传 NSIS + MSI。

## Acceptance Criteria

- [x] 写中途失败后原文件不被破坏；成功保存 round-trip —— atomicWriteText（tmp→rename）+ 单测覆盖「tmp 先写后 rename / 写失败不 rename 且清理 tmp / rename 失败抛出」
- [x] `pnpm test` 全绿（24 个，覆盖 5 类）
- [x] push 触发 `check.yml`（tsc+test+build）通过 —— run 26333467765 success
- [~] push tag 触发 `release.yml` 产出含 NSIS+MSI 的 Release —— 已按 `tauri-action` 标准配置，**待下个 `v*` tag 首次实跑验证**
- [x] `tsc --noEmit` / `vite build` clean（无 Rust 改动，`cargo check` N/A）

## Definition of Done

- AC 全勾；CI 绿；README/notes 视行为变化更新
- 不破坏 v1.0 既有行为（保存、watcher 冲突、新建/另存）

## Out of Scope

- 代码签名（无证书）
- macOS / Linux 构建
- 收紧 fs scope（v0.2 安全项，独立任务）
- logger 追加效率（独立优化项）
- 单测覆盖率门槛/徽章

## Technical Notes

- 原子文本写：JS 侧 `writeTextFile(tmp)` → `rename(tmp, path)`；Windows rename 覆盖语义需确认（Tauri fs plugin `rename` 是否允许覆盖已存在目标——需验证，必要时先 remove）。
- Vitest 对 `@tauri-apps/api` 的 mock：纯逻辑测试不碰 Tauri；涉及 fs 的原子写测试需 mock `@tauri-apps/plugin-fs`。
- `tauri-action` 需要 `GITHUB_TOKEN`（Actions 自带），tagName/releaseName 从 tag 取。

## Decision (ADR-lite) — 已确认（用户「都行」全采纳推荐）

| # | 主题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 测试框架 | Vitest / Jest | **Vitest** |
| D2 | 原子保存实现 | JS tmp+rename / 新 Rust 命令 | **JS tmp+rename** |
| D3 | CI 结构 | 仅 tag 发版构建 / 轻量检查+tag发版 两条 | **两条** |
| D4 | release 构建方式 | tauri-action / 手写 build+gh 步骤 | **tauri-action** |
| D5 | 本任务是否拆子任务 | 单任务 / 拆 R1、R2+R3 | **拆 2 个 PR：PR1 原子保存+测试骨架；PR2 测试补全+CI** |
