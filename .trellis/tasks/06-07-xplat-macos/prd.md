# xplat macOS: smoke + titlebar + Gatekeeper docs + dmg

> 父任务：`06-07-cross-platform`。在 Mac 真机（D3）上验证 + 修复 macOS 特定问题，
> 重点是自绘标题栏与"交通灯"窗口控件的冲突。中复杂度（含 UI 改动）→ `start` 前补
> `design.md` + `implement.md`。

## Goal

确认 macOS 构建产物在 Mac 真机上无白屏、功能正常；解决 `decorations:false` 下交通灯
按钮缺失/重叠；产出可分发（未签名）dmg/app + Gatekeeper 绕过文档。

## Requirements

- **R1 标题栏 / 交通灯** — `src-tauri/tauri.conf.json:21` + Titlebar 组件
  - 当前 `decorations:false` + 自绘标题栏在 macOS 会丢失关闭/最小化/缩放按钮。
  - 候选方案：macOS 用 `titleBarStyle: "Overlay"`（保留原生交通灯 + 内容延伸到标题栏），并按平台调整自绘标题栏的拖拽区与控件位置（macOS 红绿灯在左，Windows 控件在右）。**具体方案见 `design.md`。**
- **R2 真机冒烟（Mac）**：启动无白屏、Mermaid/KaTeX/代码高亮、**⌘ 快捷键**（依赖 foundation 的 mod 键）、文件监听重载、保存/另存/新建、搜索、主题、打印、数据目录落在 `~/Library/Application Support/...`、窗口可拖拽/缩放/全屏。
- **R3 Gatekeeper（D2）**：未签名 .app/.dmg；README 写明首次打开右键→打开 / `xattr -dr com.apple.quarantine <app>` 的绕过方法。
- **R4 打包**：dmg 可挂载、拖入 Applications 后可启动。
- **R5** 修复真机暴露的 macOS 特定问题（菜单栏、字体、缩放、快捷键冲突等）。

## Acceptance Criteria

- [ ] Mac 真机冒烟清单全过，无白屏、核心功能正常。
- [ ] 窗口控件（关闭/最小化/缩放）在 macOS 可见且可用；标题栏拖拽正常。
- [ ] ⌘ 系快捷键工作。
- [ ] dmg 可安装运行；README Gatekeeper 说明落地。
- [ ] 若有代码改动：`tsc` + `test`（+ 必要时 `cargo check`）通过。

## Out of Scope

- 代码签名 + notarization（D2，后续单独决策）。
- Mac App Store 上架。

## Notes

- 依赖 `xplat-foundation`（mod 键 + data_dir）+ `xplat-ci`（或本地 Mac 构建）。
- `start` 前补 `design.md`（标题栏方案：Overlay vs 自绘交通灯；按平台条件化 Titlebar 组件）+ `implement.md`。
- 可与 `xplat-linux` 并行。
