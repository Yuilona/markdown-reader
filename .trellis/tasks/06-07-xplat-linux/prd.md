# xplat Linux: Ubuntu smoke + deb/appimage + docs

> 父任务：`06-07-cross-platform`。在 Ubuntu 真机（D3）上验证构建产物可正常运行，
> 校验 deb/appimage，补 README Linux 段。轻~中复杂度，PRD（+ `implement.md`）。

## Goal

确认 Linux 构建产物在 Ubuntu 真机上无白屏、功能正常，打包格式可安装/运行，文档齐备。

## Requirements

- **R1 真机冒烟（Ubuntu）**：安装/运行 deb 或 AppImage，逐项验证——启动无白屏、Mermaid/KaTeX/代码高亮渲染、Ctrl 快捷键、文件监听重载、保存/另存/新建、搜索、主题、打印、数据目录落在 `~/.local/share/...`。
- **R2 打包**：deb 可 `apt install ./*.deb` 安装并从应用菜单启动；AppImage `chmod +x` 后可直接运行。
- **R3 文件关联（尽力）**：`.md` 双击用本应用打开（Linux `.desktop` + MIME）。若超出本轮成本，记为 follow-up。
- **R4 文档**：README 增补 Linux 安装/运行/依赖（WebKitGTK 运行时）说明。
- **R5** 修复真机暴露的 Linux 特定问题（字体回退、分数缩放、窗口装饰等，按实际发现）。

## Acceptance Criteria

- [ ] Ubuntu 真机冒烟清单全过，无白屏、核心功能正常。
- [ ] deb + AppImage 均可安装/运行。
- [ ] README Linux 段落落地。
- [ ] 若有代码改动：`tsc` + `test`（+ 必要时 `cargo check`）通过。

## Out of Scope

- 多发行版 / ARM。
- 代码签名。

## Notes

- 依赖 `xplat-foundation` + `xplat-ci`（或本地 Ubuntu 构建）产出 Linux 包。
- 可与 `xplat-macos` 并行。
