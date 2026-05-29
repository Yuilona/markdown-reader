# Code-review remediation: security / perf / cleanup / correctness

> 来源：2026-05-30 全量代码审查（6 维度并行 + 对抗式复核）。原始 49 条发现，
> 复核确认 **28 条真问题**（剔除 21 条误报/已缓解）。完整证据见
> `research/findings-full-2026-05-30.md`（每条含 file:line / evidence / fix / verdict）。
> 本任务**只做规划，不实现**（用户指示：先建任务，后面再做）。

## Goal

把审查确认的 28 条问题修掉，分四类、各为一个可独立验证的子任务。父任务持有
完整发现清单、跨子任务决策、以及最终集成验收；父任务本身不直接写实现代码。

## 确认问题分布

- 严重度：High 2 / Medium 2 / Low 20 / Info 4
- 类别：security 4 / performance 8 / correctness 7 / rust 4 / dead-code 3 / redundancy 2

## 子任务地图（children）

| 子任务 | 覆盖发现 | 优先级 | 复杂度 |
|---|---|---|---|
| `05-30-cr-security` | #2 #5 #23 #24（+#28/#25 协议侧记录） | **P1** | 轻量~中（含 1 处 tauri.conf.json 配置） |
| `05-30-cr-cleanup` | #12 #18 #19 #25 #26 | P3 | 轻量 |
| `05-30-cr-performance` | #1 #3 #4 #13 #14 #15 #16 #17 | P2 | **中~大**（含 Rust append 命令、Shiki 缓存） |
| `05-30-cr-correctness` | #6 #7 #8 #9 #10 #11 #20 #21 #22 #27 | P2 | 中（含 Rust watcher/线程改动） |

> #20≡#21（data_dir panic 重复）、#6≡#11（watcher `\\?\` 前缀重复）——各按一条修。

## 跨子任务决策（ADR-lite）— 已与用户确认

| # | 主题 | 决策 |
|---|---|---|
| D1 | 本地非 .md 文件「在系统中打开」(#2 安全 + #5 功能，捆绑) | **保持禁用 + 清理**：移除/禁掉 `local-other` 的 `shellOpen` 与图片「在系统中打开」菜单项，改成「不支持/在文件夹中显示」之类提示；不放开 shell 正则。这样 #2 攻击面被永久消除、#5 不再误导用户 |
| D2 | shell.open 校验真相 (#24) | 在 `tauri.conf.json` 显式写 `plugins.shell.open` 正则（仅 http(s)/mailto），并在 `capabilities/default.json` 注明 allow 项不参与 open 校验；不设成宽松 Validate |
| D3 | 实现节奏 | 本轮只建任务 + 写 PRD；实现留待后续 session，按子任务逐个 start |
| D4 | 复杂子任务的 design/implement | `cr-performance`（尤其 #1 Shiki 缓存、#3 logger Rust 命令）与 `cr-correctness`（Rust 改动）在各自 `task.py start` 前补 `design.md` + `implement.md`；`cr-cleanup`、`cr-security` 可 PRD-only |

## Cross-cutting Acceptance Criteria（父任务最终验收）

- [ ] 四个子任务各自 AC 全勾、各自归档
- [ ] 全程不回归 v1.2.0 既有行为（打开/保存/watcher 冲突/新建/另存/搜索/主题/打印）
- [ ] 每个涉及代码的子任务结束时：`pnpm exec tsc --noEmit` + `pnpm test` 通过；动 Rust 的子任务额外 `cargo check`（在 `src-tauri/`）
- [ ] 安全方向（D1/D2）落地后，构造性验证：恶意 .md 里 `[x](evil.hta)` 单击不再触发任何 `shellOpen`
- [ ] 行为有变更的项同步更新 README / docs（如 #5 移除「在系统中打开」需对应文案）

## Out of Scope

- 收紧 fs capability scope（独立的 v0.2 安全项，本轮不动）
- 迁移到 `tauri-plugin-opener`（#24 提到的替代方案，本轮不做，仅显式化现有插件配置）
- macOS / Linux 适配
- 21 条被复核剔除的误报（见 findings 文件 rejected 部分，不在范围）
- 大文件的完整虚拟化渲染（#4 只做阈值守卫 + 延迟高亮，不做窗口化/虚拟列表）

## Notes

- 实现时每个子任务的 context 顺序：本 PRD → 子任务 `prd.md`（→ `design.md` → `implement.md` 若有）→ `research/findings-full-2026-05-30.md` 对应条目。
- 发现编号 #N 对应 findings 文件里的 `### [N]` 小节，便于回溯证据。
