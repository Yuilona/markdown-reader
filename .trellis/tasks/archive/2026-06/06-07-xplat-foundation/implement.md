# Implement — xplat-foundation

> 顺序执行；每个 PR 后跑验证，回滚点已标注。本子任务 `task.py start` 后才动手。
> 设计见 `design.md`。

## 前置

- [ ] 用户审阅 `design.md` 通过
- [ ] `python ./.trellis/scripts/task.py start 06-07-xplat-foundation`
- [ ] 基线绿：`pnpm exec tsc --noEmit` && `pnpm test` && （`src-tauri/`）`cargo check`

## PR-1 ── 前端路径层去 Windows 化（R1b，最高优先，阻断级）

- [ ] `pathUtils.ts`：加 `IS_WINDOWS` / `IS_MAC`（navigator UA）；加 `joinUnder(dir,name)`（从 dir 推断 sep）；`normalizePath` 改平台感知（posix 恒等）；`pathsEqual` 平台感知大小写；更新顶部注释
- [ ] `persistJson.ts:73-74` `joinDataPath` → 改用 `joinUnder`（或直接删本地函数）
- [ ] `logger.ts:114` → `joinUnder(dataDir, LOG_DIR_NAME)`
- [ ] `recentFiles.ts:135` → `joinUnder(dir, tmpName)`
- [ ] `userCss.ts:49,57` 及该文件其余 `${dir}\\` → `joinUnder`
- [ ] 复核测试：`logger.test` / `userCss.test`（Windows 夹具应仍绿）、`scrollPositions.test`
- **验证**：`pnpm exec tsc --noEmit` && `pnpm test`
- **回滚**：`git checkout -- src/lib/pathUtils.ts src/lib/persistJson.ts src/lib/logger.ts src/lib/recentFiles.ts src/lib/userCss.ts`

## PR-2 ── data_dir Rust 重构（R1a）

- [ ] `data_dir.rs`：`resolve`（`#[cfg(windows)]` / `#[cfg(not(windows))]`）+ `resolve_and_create` + `pub struct DataDir(pub PathBuf)`；保留降级；`use tauri::{AppHandle, Manager}`
- [ ] `lib.rs`：setup 内 `app.manage(data_dir::DataDir(data_dir::resolve_and_create(app.handle())))`；删旧 `let _ = data_dir::data_dir();`
- [ ] `lib.rs`：`get_data_dir` 改签名 `state: tauri::State<'_, data_dir::DataDir>`
- **验证**：（`src-tauri/`）`cargo check`；Windows `pnpm tauri build` 冒烟——数据目录仍在 exe 同目录 `data/`，recent/scroll/log/userCss 读写正常
- **回滚**：`git checkout -- src-tauri/src/data_dir.rs src-tauri/src/lib.rs`

## PR-3 ── 键盘 mod 键（R2）

- [ ] `useShortcuts.ts`：加 `mod(e)`（复用 `IS_MAC`，从 pathUtils 导入或新建 platform 模块）；约 13 处 `e.ctrlKey` → `mod(e)`；更新注释
- **验证**：`pnpm exec tsc --noEmit` && `pnpm test`；Windows 手测所有 Ctrl 快捷键如常
- **回滚**：`git checkout -- src/hooks/useShortcuts.ts`

## PR-4 ── bundle targets（R3）

- [ ] `tauri.conf.json`：`bundle.targets` `["nsis","msi"]` → `"all"`
- **验证**：Windows `pnpm tauri build` 仍产 nsis+msi、无新错误
- **回滚**：`git checkout -- src-tauri/tauri.conf.json`

## 收尾验证（对应父任务 AC）

- [ ] `pnpm exec tsc --noEmit` 0 err；`pnpm test` 全绿；（`src-tauri/`）`cargo check` 通过
- [ ] Windows `pnpm tauri build` 出 nsis+msi；便携数据目录 + 快捷键**零回归**
- [ ] 代码可见三平台分支（`#[cfg]` / `IS_MAC` / `joinUnder` / `targets:"all"`）
- [ ] git 仅暂存本子任务相关源文件后提交；按需 `task.py archive`

## 顺序说明

PR-1 先行（阻断级且纯前端、Windows 上可全测）。PR-2 需 Rust。PR-3/PR-4 互相独立。
真机 ⌘ 与 posix 路径的最终验证落在 `xplat-linux` / `xplat-macos` 子任务。

## 平台探测的归属

`IS_MAC` / `IS_WINDOWS` 被 B（路径）与 C（快捷键）共用。建议放 `pathUtils.ts` 顶部导出，
或新建 `src/lib/platform.ts` 单独导出后两处 import——implement 时择一，避免重复探测。
