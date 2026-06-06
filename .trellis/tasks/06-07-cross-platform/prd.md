# Cross-platform support: macOS + Linux

> 来源：用户提出"本项目以后可以支持 mac、linux 吗，现在只有 windows 能用"。
> 基于 2026-06-07 代码勘查（`lib.rs` / `data_dir.rs` / `useShortcuts.ts` /
> `release.yml` / `tauri.conf.json`）确认：**架构无障碍**，Tauri 2 本就三平台，
> 当前 Windows-only 仅因构建与分发只面向 Windows。本任务做规划 + 分子任务实施。
> 本轮父任务**只做规划，不直接写实现代码**。

## Goal

让 markdown-reader 在 **Windows / macOS / Linux** 三平台均可构建、分发、正常运行，
且**不回归现有 Windows 行为**。父任务持有总览、子任务地图、跨子任务决策与最终集成
验收；实现拆成可独立验证的子任务。

## 现状勘查（2026-06-07）

**已跨平台就绪 ✅（无需改）**
- 前端（React / Vite / CodeMirror / Mermaid / KaTeX）100% 可移植。
- `lib.rs` 致命启动错误处理已有 `#[cfg(not(windows))]` → stderr 回退（`src-tauri/src/lib.rs:173-176`）。
- 文件监听用 `notify` crate，跨平台。
- CSP 同时含 `asset:`（Mac/Linux 用）与 `https://asset.localhost`（Windows 用），两者均保留。

**需改造（已定位到 file:line）**
| 项 | 现状 | 位置 |
|---|---|---|
| 数据目录 | 写在 exe 同目录 `data/`；macOS（`.app` 只读签名包）/ Linux（AppImage 只读挂载）**不可写** | `src-tauri/src/data_dir.rs:13-29` |
| 快捷键修饰键 | 全部 `e.ctrlKey`；macOS 期望 ⌘（metaKey）。注释自承 "v0.1 is Windows-only" | `src/hooks/useShortcuts.ts:148-150` |
| 打包目标 | `targets: ["nsis","msi"]` 全是 Windows | `src-tauri/tauri.conf.json:42` |
| CI | `release.yml` 仅在 `windows-latest` 构建 | `.github/workflows/release.yml:17` |
| 自定义标题栏 | `decorations:false` + 自绘标题栏；macOS 隐藏装饰会丢失"红绿灯"窗口控件，需专门处理 | `src-tauri/tauri.conf.json:21` |

## 用户已确认决策（2026-06-07，ADR-lite）

| # | 主题 | 决策 |
|---|---|---|
| D1 | 目标范围 | **Linux + macOS 都在本轮做到可发布**（非分阶段） |
| D2 | macOS 签名/公证 | **本轮不做公证**：产出未签名 `.app` / `.dmg`，README 教用户右键打开绕过 Gatekeeper；notarization（$99/年 Apple Developer）留作后续单独决策 |
| D3 | 测试环境 | 用户**同时拥有 Ubuntu 真机 + Mac 真机** → Linux / macOS 子任务 AC **均包含真机冒烟验证**，不只依赖 CI 构建通过 |
| D4 | 数据目录策略 | Windows 保持便携（exe 同目录 `data/`）；macOS → `~/Library/Application Support/<identifier>`；Linux → `$XDG_DATA_HOME` 或 `~/.local/share/<identifier>`。非 Windows 经 Tauri `app_data_dir()` 解析，加 `#[cfg]` 分支 |
| D5 | 实现节奏 | 本轮只建任务 + 写各 PRD；复杂子任务（`xplat-foundation`、`xplat-macos`）在各自 `task.py start` 前补 `design.md` + `implement.md`（可含 research） |
| D6 | 快捷键修饰键 | 引入 `mod` 抽象：macOS 用 `metaKey`（⌘），Windows/Linux 用 `ctrlKey`。CM6 内置绑定已用 `Mod-`，自动适配，无需改 |

## 子任务地图（children）

| 子任务 | 覆盖 | 优先级 | 复杂度 | 计划工件 |
|---|---|---|---|---|
| `xplat-foundation` | data_dir 平台分支、键盘 mod 键、bundle targets per-platform | **P1** | 中（Rust + 前端 + 配置） | PRD + design + implement |
| `xplat-ci` | GitHub Actions 三平台矩阵 + Linux 系统依赖安装 | **P1** | 中（yaml + 依赖） | PRD（+ implement） |
| `xplat-linux` | Ubuntu 真机冒烟 + deb/appimage 校验 + README | P2 | 轻~中 | PRD（+ implement） |
| `xplat-macos` | Mac 真机冒烟 + 交通灯标题栏修正 + Gatekeeper 文档 + dmg/app | P2 | 中（含标题栏 UI 改动） | PRD + design + implement |

**执行顺序**（非依赖系统，写在各子任务 PRD）：`foundation → ci →（linux ∥ macos）`。
linux/macos 的真机验证需 foundation 改动落地、且 CI 或本地能产出对应平台包后进行。

## Cross-cutting Acceptance Criteria（父任务最终验收）

- [ ] 四个子任务各自 AC 全勾、各自归档
- [ ] **Windows 零回归**：打开 / 保存 / watcher 冲突 / 新建 / 另存 / 搜索 / 主题 / 打印 / 便携数据目录 全部如 v1.3.0
- [ ] 三平台均能由 CI 在**一次 tag 推送**后产出安装包并附到同一 GitHub Release
- [ ] Linux（Ubuntu 真机）+ macOS（Mac 真机）各自冒烟通过：无白屏、Mermaid/KaTeX/代码高亮渲染正常、快捷键正确（Linux=Ctrl / macOS=⌘）、文件监听重载、数据目录落在正确平台路径
- [ ] 行为 / 安装方式有变更的项同步更新 README（三平台安装、运行、Gatekeeper 说明）
- [ ] 每个涉及代码的子任务结束：`pnpm exec tsc --noEmit` + `pnpm test` 通过；动 Rust 的额外在 `src-tauri/` 跑 `cargo check`

## Out of Scope

- macOS 代码签名 + notarization（D2，后续单独决策）
- Windows 代码签名（沿用现状：无签名 + SmartScreen 提示）
- 移动端（iOS / Android）
- Linux ARM / 全发行版穷举（本轮先 x86_64 + Debian 系 `deb` + 通用 `AppImage`）
- 主题 / 字体的逐平台像素级微调（除非影响可用性）

## Notes

- 实现时各子任务 context 顺序：本 PRD → 子任务 `prd.md`（→ `design.md` → `implement.md` 若有）。
- 版本规划建议：三平台首发作为 **v1.4.0**（新增平台属 minor 升级）。
- 关联前序：`code-review-remediation` 任务曾把 "macOS / Linux 适配" 列入 Out of Scope，本任务即其后续。
