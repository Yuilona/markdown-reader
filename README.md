<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" alt="Markdown Reader">
</p>

<h1 align="center">Markdown Reader</h1>

<p align="center">
  桌面 Markdown 阅读器，Mermaid 图可以拖动、缩放、全屏查看。
</p>

<p align="center">
  <a href="https://github.com/Yuilona/markdown-reader/actions/workflows/check.yml"><img src="https://github.com/Yuilona/markdown-reader/actions/workflows/check.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/Yuilona/markdown-reader/releases/latest"><img src="https://img.shields.io/github/v/release/Yuilona/markdown-reader?color=d97757" alt="Release"></a>
  <a href="https://github.com/Yuilona/markdown-reader/releases"><img src="https://img.shields.io/github/downloads/Yuilona/markdown-reader/total?color=3d3a35" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Platform">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
</p>

## 特性

- Mermaid 图可以拖动、全屏，按住 Ctrl 滚轮缩放；不按 Ctrl 时滚轮照常滚动页面
- 内置 Claude 衬线主题，有浅色、深色和跟随系统三种配色，也可以用 `data/user.css` 换成自己的样式
- 支持 GFM、KaTeX 公式、Shiki 代码高亮、GitHub 提示块、脚注和自动目录
- 默认是阅读模式，按 `Ctrl+E` 切到分栏编辑，左边写，右边实时预览
- 自动识别 GBK、UTF-16 等编码，保存时保持原编码
- 不联网（文档里引用的网络图片除外），没有遥测；Windows 版的数据都放在安装目录下的 `data/` 里

## 安装

从 [Releases](https://github.com/Yuilona/markdown-reader/releases/latest) 下载：

| 系统 | 安装包 |
|---|---|
| Windows | `x64-setup.exe`（推荐，可自选安装位置）或 `.msi` |
| macOS | `universal.dmg` |
| Linux | `.deb`、`.rpm` 或 `.AppImage` |

日常主要在 Windows 上测试。安装包没有签名，第一次运行时如果被 SmartScreen 拦下，点“更多信息”→“仍要运行”就行。

## 常用快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl+O` / `Ctrl+N` | 打开 / 新建 |
| `Ctrl+E` | 切换阅读 / 编辑 |
| `Ctrl+F` | 搜索 |
| `Ctrl+\` | 显示 / 隐藏目录 |
| `Ctrl+T` | 切换配色 |
| `Ctrl+,` | 设置 |
| `Alt+←` / `Alt+→` | 后退 / 前进 |
| `Ctrl+=` / `Ctrl+-` | 页面缩放 |

## 从源码构建

需要 Node 18+、pnpm 和 Rust。

```bash
pnpm install
pnpm tauri dev     # 开发
pnpm test          # 测试
pnpm tauri build   # 打包
```

主题定制见 [docs/theming.md](docs/theming.md)。

## 致谢

[Tauri](https://tauri.app/) · [react-markdown](https://github.com/remarkjs/react-markdown) · [Mermaid](https://mermaid.js.org/) · [Shiki](https://shiki.style/) · [KaTeX](https://katex.org/) · [CodeMirror](https://codemirror.net/)，内置字体 Source Serif 4、Inter、JetBrains Mono、Noto Serif SC（SIL OFL 1.1）。

## License

暂未确定开源协议。
