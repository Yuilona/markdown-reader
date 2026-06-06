# CR-Correctness: watcher 路径 / Rust panic / 编辑器同步小 bug

> 父任务：`05-30-code-review-remediation`。来源发现：#6 #7 #8 #9 #10 #11 #20 #21 #22 #27。
> 证据见父任务 `research/findings-full-2026-05-30.md` 对应 `### [N]` 小节。
> 去重：#6≡#11（watcher `\\?\` 前缀）、#20≡#21（data_dir panic）——各按一条修。
> 含 Rust 改动，`task.py start` 前视情补 `design.md` / `implement.md`。

## Goal

修掉审查确认的正确性/健壮性缺陷：文件监视的路径匹配与线程生命周期、Rust 启动期 panic
兜底、编辑器同步与快捷键的边角 bug，以及一致性 nit。均为 Low/Info，无安全/数据丢失风险，
但都是真实缺陷或会误导维护者的代码。

## What I already know（已核实）

- **#6 ≡ #11（Low）watcher `paths_equal_loose` 在原子重命名窗口漏匹配**：
  `file_watcher.rs:96` target 用 `std::fs::canonicalize` → Windows 带 `\\?\` 前缀；事件路径 `p` 由
  watched parent + 文件名拼出、**无** `\\?\`。当 `canonicalize(p)` 失败（正是 temp+rename 那一刻）
  回退到 `paths_equal_loose`（`:222-226`，只 lowercase + `/`→`\`，**不剥 `\\?\`**），于是
  `\\?\c:\..` ≠ `c:\..` 恒为 false → 该窗口的事件被丢（自动重载可能漏触发）。复核确认：实际影响有限
  （一次保存多事件、文件落定后的事件能 canonicalize 成功补触发），故 Low；「误匹配 sibling」一说不成立。
- **#10（Low）防抖 worker 线程不受管控**：debounce `deadline` Arc 与 `thread::spawn` 的 worker
  （`file_watcher.rs:160`）不属于 `ActiveWatcher`；`stop_watching`(`:216 *guard=None`) 只 drop
  `_watcher`（停 notify OS 线程），**停不掉**正在 sleep 的 worker → 可能对已停监视的路径发一条陈旧
  `file-changed`（前端 `pathsEqual` 通常会过滤）。快速连续 `start_watching` 可短暂并存多条 debounce 时间线。
  worker 无 JoinHandle、生命周期无人管。`:216` 注释「thread exits」对 worker 是误导。
- **#7（Low）`suppressPreviewScrollRef` 一次性标志泄漏**：`DocumentView.tsx:237-238` 预览点击**无条件**置位，
  但只在 `useEditorScrollSync.ts:124-127` 的防抖 `run` 里消费，而 `run` 仅当 effect 因 `cursorLine`
  （`DocumentView.tsx:210`，行号原始值）变化而重跑时才调度。若点击的块映射到光标**已在的同一行**，行号不变 →
  effect 不重跑 → 标志卡在 `true`；下一次真正跨行移动的 scroll+flash 被静默吞掉（功能看起来随机漏一次高亮）。
- **#8（Low）外部冲突弹窗可叠加**：`useFileWatcher.ts:165` 每个 `file-changed` 事件独立 async handler 调
  `confirm(...)`，`useConfirm` 是 FIFO 入队（`:68`），无 per-path 去重。模态打开期间外部多次 debounce 写入
  → 同一冲突弹 N 次。注：'keep' 分支保持 dirty 以便下次再提示是**有意设计**（非 bug）；'reload' 走二次
  `loadDocument` 取新值（非 stale）。仅多余提示，无数据风险。
- **#9（Low/死代码）`Ctrl+G` 半截分支**：`useShortcuts.ts:207-209` 只有 `if(isInCodeMirror) return;`，
  无 else/preventDefault/动作、not-in-CM 也不 return；后续无 `'g'` 分支，纯死/误导代码。F3 子说法不成立——
  docstring 说 F3「pass through to CM6」是准确的（编辑器内由 CM6 native、阅读模式由 `SearchBar.tsx` 处理）。
- **#20 ≡ #21（Low）`data_dir()` `.expect()` panic**：`data_dir.rs:12-16` 对 `current_exe()`/`.parent()`
  用 `.expect()`，在 setup 钩子(`lib.rs:106`)与 `get_data_dir` 命令里调用；失败=进程 panic（同函数后面的
  `create_dir_all` 却已优雅处理，风格不一）。复核：Windows 上运行中 exe 被锁、`current_exe()` 极少失败、
  `.parent()` 几乎不为 None，且非恶意文档可达——故 Low/健壮性 nit，但值得统一为优雅降级。
- **#22（Low）`run().expect()` 静默崩溃**：`lib.rs:115-116` `.expect(...)` + `main.rs:2`
  `windows_subsystem="windows"`（release 无控制台）→ 运行时错误（如目标机缺 WebView2，便携包尤甚）=
  进程静默消失、无任何提示。
- **#27（Info）mutex 中毒处理不一致**：`lib.rs:26` take_cli_launch_path 中毒静默返回 None；
  watcher debounce 用 `into_inner()` 恢复；`start/stop_watching` 把中毒 stringify 给前端。三种策略并存。
  所guard 数据都是单个 `Option<T>`、无多字段不变量，中毒实际良性——仅一致性 nit。

## Requirements

### R1（#6/#11）watcher 路径匹配修正
- `paths_equal_loose` 比较前剥掉两侧 `\\?\`（及 `\\?\UNC\`→`\\`）前缀；或改为按 basename + parent 比较
  （watcher 已限定单一 parent，basename 匹配即足够且免疫前缀/短名差异）。

### R2（#10）watcher worker 线程可取消 + 修注释
- 给 `ActiveWatcher` 加 generation/cancel token（如 `Arc<AtomicBool>`/`Arc<AtomicU64>`），worker emit 前检查；
  `stop_watching` 与 swap 路径置位/自增，使陈旧 worker 变 no-op。或存 JoinHandle + stop channel。
- 至少修正 `:216` 「thread exits」误导性注释。

### R3（#7）修 suppress 标志泄漏
- 取下列其一：(a) 仅当 `bodyLine + lineOffset !== cursor?.line` 才置位（同行无跳转、无需抑制）；
  (b) 微任务/短超时兜底自愈；(c) 让 jumpToEditorLine 返回行是否真的变化，未变则不置位。默认 (a)。

### R4（#8）冲突弹窗去重
- 加 per-path `inFlightConflictRef`：同路径已有冲突弹窗时，后续 `file-changed` 忽略（或替换待处理项），不再入队叠加。

### R5（#9）清理死 `Ctrl+G` 分支
- 删除 `useShortcuts.ts:207-209` 的死半截分支（CM6 本就能处理）。docstring 关于 F3 的描述准确，无需改（如要更清晰可微调）。

### R6（#20/#21）data_dir 优雅降级
- `data_dir()` 改返回 `Result`/`Option`，`current_exe()` 失败时回退（如 `temp_dir()`/OS app-data）或上抛给
  `get_data_dir` 让前端弹 toast，而非 panic。`.parent()` 同样优雅处理。与该函数已有的 `create_dir_all`
  错误处理风格统一。

### R7（#22）启动失败可见化
- `run()` 的 `Err` 分支用原生 message box（`tauri-plugin-dialog` 已是依赖，或裸 `MessageBoxW` 更稳）提示后
  非零退出，让缺 WebView2 等失败有可操作信息而非静默消失。

### R8（#27，可选）mutex 中毒策略统一
- 统一为 watcher 用的 `into_inner()` 恢复（数据非不变量敏感），避免 CLI launch 在中毒时静默失效。优先级最低。

## Acceptance Criteria

- [x] R1：`paths_equal_loose`/canonicalize 比较换成**父目录内 basename 大小写比较**（精确且免疫 `\\?\`/短名），原子重命名窗口不再漏匹配；`cargo check`+`cargo build` 通过
- [x] R2：`ActiveWatcher` 加 `Arc<AtomicBool> cancel`，worker emit 前检查、`stop_watching`/swap 置位 → 在途 worker 变 no-op，不再发陈旧 `file-changed`；`:216` 注释更正
- [x] R3：`handlePreviewClick` 仅当 `targetLine !== cursor?.line` 才置 suppress 标志 → 点同一行不再让标志卡死、吞掉下次跨行的滚动/高亮
- [x] R4：`useFileWatcher` 加 `conflictInFlightRef`，冲突弹窗打开期间忽略后续事件（`.finally` 复位）→ 不再叠加 N 个相同弹窗
- [x] R5：删除 `useShortcuts.ts` 死 `Ctrl+G` 半截分支；改注释说明 Ctrl+G/F3 故意不拦（CM6/SearchBar 自处理）
- [x] R6：`data_dir()` 改 `current_exe().ok()...unwrap_or_else(temp_dir)` 优雅降级，不再 panic；`cargo build` 通过
- [x] R7：`run()` 末尾 `match` 取代 `.expect()`；失败时 `#[cfg(windows)]` **MessageBoxW**（`#[link(name="user32")]`，无新 crate）弹原因 + 退出；`cargo build` 确认 user32 链接解析
- [x] R8：`take_cli_launch_path` 与 watcher 的 state 锁统一为 `into_inner()` 中毒恢复
- [x] `pnpm exec tsc --noEmit`(0) + `pnpm test`(44/44) + `pnpm build`(ok) + `cargo check`(0) + `cargo build`(0) 全通过；无功能回归

> 验证说明：以上经**编译/链接/类型/单测/构建**与代码推理确认。R1/R2/R7 的运行期行为（实际外部改写重载、停表后无陈旧事件、缺 WebView2 弹窗）在本环境无法实跑；建议封板前在 app 内做一次目检：外部编辑器改写当前文件→自动重载；编辑态有未保存改动时外部改写→只弹一次冲突框；预览点击行高亮联动。

## Out of Scope

- watcher 改用 notify 自带 debouncer / 升级 notify 7.x（独立评估）
- 编辑器滚动同步的性能优化（归 `cr-performance` #15；本任务只修 #7 正确性，注意同文件协调）

## Technical Notes

- R1/R2 都在 `src-tauri/src/file_watcher.rs`，建议同一 PR 一起改并加/补 Rust 单测（若可行）。
- R3 与 `cr-performance` R6 同改 `useEditorScrollSync.ts`，先做正确性(R3) 再做性能(R6) 或合并协调，避免冲突。
- Rust 改动后务必在 `src-tauri/` 跑 `cargo check`（前端 `tsc`/`test` 覆盖不到 Rust）。
