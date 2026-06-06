# CR-Correctness — Technical Design

> 父任务 `05-30-code-review-remediation`。配套 `prd.md`（需求 R1–R8）+ `implement.md`（执行）。
> 证据见父任务 `research/findings-full-2026-05-30.md`。本设计基于对当前源码的精读
> （`file_watcher.rs` / `data_dir.rs` / `lib.rs` 全文 2026-05-30）。

## 分组与边界

三个互相独立、可分别验证的改动簇（按 PR 落地，见 implement.md）：

- **A. Rust 文件监视**（`src-tauri/src/file_watcher.rs`）：R1 路径匹配、R2 worker 取消。
- **B. Rust 启动健壮性**（`src-tauri/src/data_dir.rs` + `lib.rs`）：R6 data_dir panic、R7 run() 静默崩溃、R8 mutex 中毒一致性。
- **C. 前端边角 bug**（`useEditorScrollSync.ts`/`DocumentView.tsx`、`useFileWatcher.ts`、`useShortcuts.ts`）：R3 suppress 标志、R4 冲突弹窗去重、R5 死 Ctrl+G。

> 跨任务约束：R3 改 `useEditorScrollSync.ts`，cr-performance R6 也改同文件——**先做本任务（正确性）**再做性能，已满足。

---

## A. 文件监视（file_watcher.rs）

### R1（#6/#11）路径匹配 —— 改用 basename 比较
**现状**：handler 里 `std::fs::canonicalize(p)==target_canonical`，失败时 fallback `paths_equal_loose`（只 lowercase + `/`→`\`，**不剥 `\\?\`**）。target 经 `canonicalize` 带 `\\?\` 前缀，事件路径 `p` 不带 → 原子重命名窗口（canonicalize 失败）下 loose 比较恒 false，事件被丢、自动重载漏触发。

**设计**：watcher 已 `RecursiveMode::NonRecursive` 监视**单一父目录**，故该目录内任何事件只要 **basename 与 target 的 basename 大小写不敏感相等**即是我们的文件——天然免疫 `\\?\`/8.3 短名/盘符大小写差异，且省掉每事件一次 `canonicalize` 系统调用。
- 在 `start_watching` 预计算 `let target_name = target_path.file_name()` 的小写 `String`（move 进 handler）。
- handler 的 `matches_target` 改为：`event.paths.iter().any(|p| p.file_name() 的小写 == target_name)`。
- 删除 `target_canonical` / `target_for_handler` / `paths_equal_loose`（不再需要 canonicalize 比较）。`ActiveWatcher.target` 仍保留原始 `target_path` 作诊断（去掉 `canonicalize`）。

> 取舍：basename 比较 vs「剥 `\\?\` 前缀」。选 basename——更简单、无 syscall、对单父目录场景是精确匹配（同目录不可能有重名文件）。

### R2（#10）debounce worker 可取消 + 修注释
**现状**：`deadline` Arc 与 `thread::spawn` 的 worker 不属于 `ActiveWatcher`；`stop_watching`/swap 只 drop `_watcher`（停 notify OS 线程），**停不掉**正在 `sleep` 的 worker → 对已停路径发一条陈旧 `file-changed`。`:216` 注释「thread exits」对 worker 是误导。

**设计**：给每个 watcher 一个 `cancel: Arc<AtomicBool>` 取消令牌。
- `ActiveWatcher` 增字段 `cancel: Arc<AtomicBool>`。
- `start_watching`：`let cancel = Arc::new(AtomicBool::new(false));` → clone 进 handler 闭包 → 再 clone 进 worker。
- worker：`thread::sleep` 醒来、**emit 之前**检查 `cancel.load(Ordering::SeqCst)`；为 true 则直接 `return`（不 emit）。循环顶部也可早退。
- `stop_watching` 与 `start_watching` 的 swap：替换/清空前 `if let Some(old) = guard.as_ref() { old.cancel.store(true, SeqCst); }`，使旧 watcher 的在途 worker 变 no-op。
- 新增 `use std::sync::atomic::{AtomicBool, Ordering};`。
- 修正 `:216` 注释：说明 drop `_watcher` 停的是 notify 线程，debounce worker 由 `cancel` 令牌使其最后一次唤醒成为 no-op。

> 不引入 JoinHandle/channel（更重）；AtomicBool 取消令牌足够：worker 生命周期 ≤ 200ms + 一次锁，取消后最多空转到下次检查即退出，不 emit。

---

## B. 启动健壮性（data_dir.rs + lib.rs）

### R6（#20/#21）data_dir() 不再 panic
**现状**：`current_exe().expect(...)` + `.parent().expect(...)` → 失败即 panic（setup 钩子里会中止启动）。

**设计**：优雅降级，保持返回类型 `PathBuf`（`get_data_dir` 不变）：
```
let data = std::env::current_exe().ok()
    .and_then(|p| p.parent().map(Path::to_path_buf))
    .map(|dir| dir.join("data"))
    .unwrap_or_else(|| std::env::temp_dir().join("markdown-reader-data"));
```
后续 `create_dir_all` 错误处理保持现有 `if let Err` 风格。即极端情况下退到临时目录而非崩溃，与同函数已有的非 panic 风格一致。

### R7（#22）run() 失败不再静默消失 —— ⚠️ 需你确认实现方式
**现状**：`.run(generate_context!()).expect("error while running tauri application")` + `windows_subsystem="windows"`（release 无控制台）→ 任何运行时错误（最常见：目标机缺 WebView2 运行时，便携包尤甚）= 进程静默消失、零提示。

**两个实现选项（评审门请你选）**：
- **选项 A（推荐）原生弹窗**：`run()` 返回 `Err` 时，用一小段 `#[cfg(windows)]` `MessageBoxW` FFI（声明 `extern "system"`，链接 user32，无需新 crate）弹出「启动失败：<err>。请确认已安装 WebView2 运行时」，再 `exit(1)`。最有用——用户能看到原因。代价：一个 `unsafe` FFI 块（Windows-only）。
- **选项 B（更轻）崩溃日志**：`Err` 时把错误写到 `<data_dir>/last-start-error.log` + `eprintln`，再 `exit(1)`。无 unsafe、无 FFI，但用户不会主动看到（需自己翻日志）。

> 不用 `tauri-plugin-dialog`：run() 已失败、插件未初始化，拿不到可用的 AppHandle。

### R8（#27）mutex 中毒策略统一
**现状**：`take_cli_launch_path` 中毒静默返回 None（`.lock().ok()`）；watcher 用 `into_inner()` 恢复；`start/stop_watching` 把中毒 stringify 给前端——三种策略并存。所 guard 数据都是单个 `Option<T>`，中毒实际良性。

**设计**：统一为 watcher 的 `into_inner()` 恢复。`take_cli_launch_path` 改为
`let mut g = state.0.lock().unwrap_or_else(|p| p.into_inner()); g.take()`，使一次性 panic 不会让 CLI 启动永久静默失效。`start/stop_watching` 的 `.map_err(to_string)?` 可一并改为 `into_inner()` 恢复（可选，优先级最低）。

---

## C. 前端边角（frontend）

> 实现时会先精读 `handlePreviewClick`（DocumentView ~230-245）与 `useFileWatcher` 冲突分支拿到精确代码；以下为方案。

### R3（#7）suppressPreviewScrollRef 不再泄漏
**现状**：预览点击**无条件**置 `suppressPreviewScrollRef.current=true`，但只在 `useEditorScrollSync` 的防抖 `run` 里消费，而 `run` 仅当 `cursorLine` 变化时才跑。点到光标已在的同一行 → `cursorLine` 不变 → 标志卡 true → 下次真正跨行移动的 scroll+flash 被吞。

**设计**：方案 (a)——在 `handlePreviewClick` 里**仅当** `bodyLine + lineOffset !== cursor?.line` 才置位（同行点击不会触发跳转，无需抑制）。改动点小、无新状态。

### R4（#8）外部冲突弹窗去重
**现状**：每个 `file-changed` 事件独立 handler 调 `confirm(...)`，`useConfirm` FIFO 入队、无 per-path 去重 → 模态打开期间外部多次写入弹 N 次。

**设计**：在 `useFileWatcher` 加 `inFlightConflictRef = useRef(false)`。进入冲突分支前若已 true 则直接忽略本次事件；置 true → `await confirm(...)` → finally 置回 false。保证同一时刻只有一个冲突框。

### R5（#9）删死 Ctrl+G 分支
**现状**：`useShortcuts.ts:207-209` 仅 `if (e.ctrlKey&&!shift&&!alt&&key==='g'){ if(isInCodeMirror) return; }`，无 else/动作/preventDefault，后续也无 `'g'` 分支——纯死代码（CM6 本就能处理 Ctrl+G）。F3 的 docstring 描述准确，不动。

**设计**：删除该半截分支。

---

## 验证矩阵

| 簇 | 命令 |
|---|---|
| A、B（Rust） | `cargo check`（src-tauri）；可行时加 file_watcher 的 basename 匹配单测 |
| C（前端） | `pnpm exec tsc --noEmit` + `pnpm test` + `pnpm build` |
| 全部 | 不回归：打开/保存/外部修改重载/编辑器行高亮联动/搜索/快捷键 |

## 风险

- A：basename 比较改变了匹配语义（虽对单父目录等价），需确认 watcher 始终只监视单一父目录（现状如此）。
- R7-选项A：`unsafe` FFI，仅 Windows；需 `cargo check` 通过且不影响 release 链接。
- C-R3：避免与 cr-performance R6（同文件）冲突——本任务先行。
