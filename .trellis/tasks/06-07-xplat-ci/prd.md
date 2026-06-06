# xplat CI: tri-platform GitHub Actions matrix

> 父任务：`06-07-cross-platform`。把 `.github/workflows/release.yml` 从仅 Windows
> 扩成三平台矩阵，让一次 tag 推送产出 Win / macOS / Linux 安装包并附到同一 Release。
> 中复杂度（yaml + 系统依赖）。可 PRD + `implement.md`。

## Goal

扩展发布工作流为 `windows-latest` + `macos-latest` + `ubuntu-22.04` 矩阵，
tauri-action 各自打包并上传到**同一** GitHub Release。

## Requirements

- **R1 矩阵**：`strategy.matrix` 含三 runner，保留现有 pnpm / node / rust 缓存步骤。
- **R2 Linux 系统依赖**：ubuntu runner 构建前安装 WebKitGTK 等（参考 Tauri 2 Linux 文档：`libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`librsvg2-dev`、`libayatana-appindicator3-dev`、`build-essential` 等；**具体包名以 start 时 Tauri 2 当前文档为准**）。
- **R3 macOS**：未签名构建（D2，不配 notarization 密钥）；指定目标架构（Apple Silicon `aarch64`，可选附 Intel `x86_64`）。
- **R4 上传**：tauri-action 三平台产物附到同一 tag 的 Release（沿用现有 tagName/releaseName，releaseDraft=false）。
- **R5** 不破坏现有 Windows 发布路径。

## Acceptance Criteria

- [ ] 推送测试 tag（如 `v1.4.0-rc.1`）后，Actions 三 job 全绿，GitHub Release 同时挂出：Windows nsis/msi、macOS dmg、Linux deb/appimage。
- [ ] Windows 产物与现状一致（无回归）。
- [ ] 工作流 YAML 无语法错误，矩阵正确展开。

## Out of Scope

- 真机运行验证（CI 只保证"构建 + 打包成功"；运行验证归平台子任务）。
- 代码签名 / 公证。

## Notes

- 依赖 `xplat-foundation` 的 bundle targets。
- 测试 tag 用 pre-release 形式避免污染正式版本号；验证后删除测试 tag/release。
- start 前到 Tauri 2 官方文档核对当前 Linux 依赖包名与 `tauri-action` 参数（可用 context7）。
