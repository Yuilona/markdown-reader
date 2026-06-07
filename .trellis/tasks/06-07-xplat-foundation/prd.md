# xplat foundation: data dir + keyboard mod + bundle targets

> 父任务：`06-07-cross-platform`。本子任务承载 Linux / macOS **共同需要**的跨平台
> 代码改造，可在不回归 Windows 的前提下先行落地，是其余平台子任务的前置。
> 复杂度中：含 Rust（data_dir cfg）+ 前端（mod 键）+ 配置（bundle targets）。
> 按父任务 D5，`task.py start` 前需补 `design.md` + `implement.md`。

## Goal

落实三处共享改造：(1) 数据目录按平台分流；(2) 键盘修饰键 macOS 用 ⌘；
(3) 打包目标按平台配置。**Windows 行为零回归。**

## Requirements

- **R1a 数据目录 / Rust（D4）** — `src-tauri/src/data_dir.rs`
  - Windows 保持便携：exe 同目录 `data/`（现状不变）。
  - 非 Windows 走 `#[cfg(not(windows))]` 分支，经 Tauri `app_data_dir()`（基于 identifier `com.yuilona.markdownreader`）：macOS → `~/Library/Application Support/...`，Linux → `$XDG_DATA_HOME` 或 `~/.local/share/...`。
  - 保留现有健壮性：取不到则 fallback 到 temp 子目录、`create_dir_all` 失败仅 warn 不 panic（R6/#20/#21）。
  - ⚠ 设计点：`data_dir()` 当前是**无 AppHandle 的自由函数**，而 `app_data_dir()` 需要 `AppHandle`/`PathResolver`。方案见 `design.md` A 节（setup 解析一次 + 托管 state）。
- **R1b 前端路径层去 Windows 化（勘查新增，阻断级）** — `src/lib/pathUtils.ts` 等
  - ⚠ `pathUtils.normalizePath` 把 `/`→`\`，被每次文件打开/保存调用 → **非 Windows 上文件直接打不开**。比 R1a 更优先。
  - `normalizePath` / `pathsEqual` 改平台感知；4 处硬编码 `\\` 数据目录拼接（`persistJson`/`logger`/`recentFiles`/`userCss`）改用从 dir 推断分隔符的 `joinUnder`。详见 `design.md` B 节。
- **R2 键盘 mod 键（D6）** — `src/hooks/useShortcuts.ts`
  - 引入 `mod`（macOS = `metaKey`，Windows/Linux = `ctrlKey`），替换所有 `e.ctrlKey` 判断。
  - 平台探测一次（Tauri `platform()` 或 `navigator`）。保留现有 CM6 gate（CM6 用 `Mod-`，自动适配）。
- **R3 bundle targets** — `src-tauri/tauri.conf.json`
  - 按平台产出：Windows nsis+msi（不变）；macOS app+dmg；Linux deb+appimage。优先用 Tauri per-platform bundle 配置或 `"targets": "all"`，必要时显式列出。
- **R4** 不引入对 Windows 的回归。

## Acceptance Criteria

- [ ] Windows：`pnpm tauri build` 仍产出 nsis+msi；数据目录仍在 exe 同目录 `data/`；快捷键全部如常。
- [ ] `pnpm exec tsc --noEmit` + `pnpm test` 通过；`src-tauri/` 内 `cargo check` 通过。
- [ ] 代码可见三平台分支（cfg / mod / targets），非 Windows 分支可编译（本地交叉或 CI 验证）。
- [ ] mod 键正确：macOS ⌘O/⌘S 触发、Windows/Linux Ctrl 触发（真机最终验证落在 linux/macos 子任务）。
- [ ] 路径层平台感知：`normalizePath` posix 恒等、`joinUnder` 三平台正确——非 Windows 上文件打开 + 数据目录读写不再因分隔符失败（真机最终验证落 linux/macos）。

## Out of Scope

- 平台真机冒烟（归 `xplat-linux` / `xplat-macos`）。
- CI 矩阵（归 `xplat-ci`）。

## Notes

- 执行顺序：本子任务**最先**做，其余平台子任务依赖它。
- `start` 前补 `design.md`（重点：data_dir 取 AppHandle 的方案、mod 键平台探测方式）+ `implement.md`（有序步骤 + 验证命令）。
