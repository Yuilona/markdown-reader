# CR-Correctness — Execution Plan

> 配套 `prd.md` + `design.md`。三个独立 PR，按下序落地；每个 PR 结束跑对应验证、独立可回滚。

## 待你确认（评审门）
- **R7 实现方式**：选项 A（原生 MessageBoxW 弹窗，推荐）/ 选项 B（崩溃日志文件）。默认按 A。
- 其余 R1–R6/R8 方案见 design.md，无悬而未决点。

---

## PR-1 ── Rust 文件监视（R1 + R2）`file_watcher.rs`
- [ ] R1：`start_watching` 预计算 `target_name`（`target_path.file_name()` 的小写 `String`），move 进 handler
- [ ] R1：`matches_target` 改为 basename 小写相等比较；删 `target_canonical`/`target_for_handler`/`paths_equal_loose`；`ActiveWatcher.target` 存原始 `target_path`
- [ ] R2：`use std::sync::atomic::{AtomicBool, Ordering}`；`ActiveWatcher` 加 `cancel: Arc<AtomicBool>`
- [ ] R2：`start_watching` 建 `cancel`，clone 进 handler→worker；worker emit 前检查 `cancel`，true 则 return 不 emit
- [ ] R2：`stop_watching` 与 swap 在替换/清空前 `old.cancel.store(true, SeqCst)`；修正 `:216` 注释
- [ ] （可选）加一个 basename 匹配的 Rust 单测
- **验证**：`cd src-tauri && cargo check`
- **回滚点**：单文件，`git checkout -- src-tauri/src/file_watcher.rs`

## PR-2 ── Rust 启动健壮性（R6 + R7 + R8）`data_dir.rs` + `lib.rs`
- [ ] R6：`data_dir()` 改 `current_exe().ok()...unwrap_or_else(temp_dir)` 降级；`use std::path::Path`
- [ ] R7：按确认的选项实现（A=MessageBoxW FFI / B=崩溃日志）；`run()` 末尾 `match` 取代 `.expect()`
- [ ] R8：`take_cli_launch_path` 改 `into_inner()` 恢复；（可选）`start/stop_watching` 同样
- **验证**：`cd src-tauri && cargo check`（确认 FFI/降级编译通过、release 链接无碍）
- **回滚点**：`git checkout -- src-tauri/src/data_dir.rs src-tauri/src/lib.rs`

## PR-3 ── 前端边角（R3 + R4 + R5）
- [ ] 先精读 `DocumentView` 的 `handlePreviewClick`、`useFileWatcher` 冲突分支、`useShortcuts` Ctrl+G 分支
- [ ] R3：`handlePreviewClick` 仅当 `bodyLine + lineOffset !== cursor?.line` 才置 `suppressPreviewScrollRef`
- [ ] R4：`useFileWatcher` 加 `inFlightConflictRef`，冲突分支去重（已开则忽略；try/finally 复位）
- [ ] R5：删 `useShortcuts.ts` 死 Ctrl+G 半截分支
- **验证**：`pnpm exec tsc --noEmit` + `pnpm test` + `pnpm build`
- **回滚点**：`git checkout --` 对应前端文件

---

## 收尾（Phase 3）
- [ ] 三个 PR 全绿后，勾选 `prd.md` 验收项
- [ ] 提交（建议 3 个 commit 对应 3 个 PR，或合并为 1–2 个）；commit 末尾带 Co-Authored-By trailer
- [ ] `task.py finish` + `task.py archive 05-30-cr-correctness`（auto-commit 移动）
- [ ] 不回归 v1.2.0 既有行为

## 验证命令速查
```bash
# 前端
pnpm exec tsc --noEmit && pnpm test && pnpm build
# Rust（动 src-tauri 后）
cd src-tauri && cargo check
```
