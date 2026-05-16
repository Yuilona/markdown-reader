# markdown-reader

一个让 Mermaid 图能够拖动、缩放、全屏的桌面 Markdown 阅读器。

## 这个工具解决什么问题

市面上绝大多数 Markdown 阅读器把 Mermaid 渲染成一张固定大小的图片：
看不清细节、放不大、滚轮会被劫持、想全屏更没门。这个项目把 Mermaid
当成一等公民来对待：每一张图都能拖、能缩、能全屏，并且不会偷走页面
滚轮。除此之外它是一个克制的 GitHub-style 单文件 Markdown 阅读器
——不是编辑器，不带 tab，不联网（除非你的 markdown 自带远程链接）。

## 主要特性

- 行内 Mermaid 拖拽 / 缩放（Ctrl+滚轮缩放，纯滚轮滚页面 —
  修复了几乎所有竞品的滚动劫持）
- Mermaid 全屏 lightbox（光标锚定缩放）
- 图片点击全屏
- 浅色 / 深色 / 跟随系统三主题，200ms 渐变过渡
- 文件内 Ctrl+F 搜索（支持大小写 / 整词 / 正则；跳过代码块外的
  Mermaid SVG 与 KaTeX 公式）
- 自动 TOC 右侧栏，跟随当前阅读区域高亮
- 拖拽打开 + 最近 10 文件 + Windows 文件关联
- 外部编辑器保存自动重载（保留滚动位置）
- 链接路由：HTTP → 系统浏览器 / 本地 .md → 当前窗口 /
  其他本地文件 → 系统默认应用
- 打印（强制亮色 + 隐藏 chrome + 代码自动换行 + 链接 URL 追加）
- 右键菜单（复制链接 / 图片 / Mermaid 为图片）
- 滚动位置 / 主题 / 页面缩放 / TOC 显隐持久化
- 便携安装：数据目录就在程序目录下的 `data/`，删除安装目录即清理干净

## 系统要求

- Windows 11（Win10 大概也行，未测试）
- WebView2 运行时（Win11 内置；Win10 用户从 Microsoft 官网下载
  Evergreen Bootstrapper 安装即可）

## 安装

### 方式一（推荐）：NSIS 安装包

从 [Releases 页](https://github.com/Yuilona/markdown-reader/releases)
下载 `markdown-reader_x.y.z_x64-setup.exe`，运行后**自行选择安装路径**
（必须选可写位置；不要装到 Program Files，否则 portable 数据目录
无法创建）。NSIS 安装器原生支持 "Choose Install Location" 步骤，
所以路径选择是必经流程。

> 首次运行时 Windows SmartScreen 会拦一下（v0.1 没有代码签名），
> 点 "更多信息" → "仍要运行" 即可。这是 v0.1 个人项目的预期行为。

### 方式二：MSI 安装包

也可以下载 `markdown-reader_x.y.z_x64_en-US.msi`。**注意**：MSI 走
Windows Installer 默认会装到 `C:\Program Files\` —— 那个位置写不进
程序自带的 `data/` 目录，所以 portable 行为会失效。如果你想用 MSI
但又要 portable，请在 Windows Installer 提示安装路径时手动改到一个
你账户可写的目录。**追求 portable 一律推荐方式一**。

### 方式三：从源码构建

需要：Node 18+、pnpm、Rust 1.7+（msvc toolchain）、Microsoft C++
Build Tools。

```bash
pnpm install
pnpm tauri dev    # 开发模式：热重载 React + Tauri shell
pnpm tauri build  # 构建 release（生成 NSIS .exe + MSI 到 src-tauri/target/release/bundle/）
```

构建产物：
- `src-tauri/target/release/bundle/nsis/markdown-reader_x.y.z_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/markdown-reader_x.y.z_x64_en-US.msi`

## 数据目录

app 把所有持久化数据放在**安装目录下的 `data/` 子文件夹**。这意味着
卸载只需要删掉整个安装目录，不会有遗留文件散落在 AppData。

文件清单：

| 文件 | 用途 |
|---|---|
| `settings.json` | 主题模式、页面缩放、TOC 默认显隐 |
| `recent.json` | 最近 10 文件（LRU、去重） |
| `scroll-positions.json` | 每文件滚动位置（LRU 100） |
| `user.css` | 用户自定义样式（启动时一次性加载，写在 `<head>` 最末） |
| `logs/app.log` | 滚动日志（5MB 上限 + 7 天保留 `.bak`） |

> v0.1 暂未持久化窗口尺寸 / 位置 / 最大化状态（`window.json`，
> PRD R2.8 / R10.1）—— 每次启动使用 tauri.conf.json 中的默认尺寸
> （1000×700，居中）。完整窗口状态恢复规划在 v0.2。

> 当前 v0.1 没有 GUI 设置面板，要改主题以外的设置（页面缩放区间、
> 默认显示 TOC 等）请直接编辑 `data/settings.json`。完整的 GUI
> 设置面板规划在 v0.2。

## 键盘快捷键

| 快捷键 | 行为 |
|---|---|
| `Ctrl+O` | 打开文件 |
| `Ctrl+W` | 关闭当前文件（回到空状态） |
| `Ctrl+Q` | 退出 app |
| `Ctrl+R` / `F5` | 重新加载当前文件 |
| `Ctrl+F` | 文件内搜索 |
| `Enter` / `F3` | 下一个匹配 |
| `Shift+Enter` / `Shift+F3` | 上一个匹配 |
| `Esc` | 关闭搜索 / 关闭 lightbox / 关闭右键菜单 |
| `Ctrl+P` | 打印（系统对话框含 "保存为 PDF"） |
| `Ctrl+\` | 切换 TOC 侧栏 |
| `Ctrl+T` | 循环切换主题（浅色 → 深色 → 跟随系统） |
| `Ctrl+=` | 页面缩放 +10% |
| `Ctrl+-` | 页面缩放 -10% |
| `Ctrl+0` | 页面缩放复位 100% |
| `F11` | 切换窗口全屏 |
| `Ctrl+滚轮`（在 Mermaid 图上） | 缩放图（不滚页面） |

快捷键在 v0.1 不可重绑定。

## 隐私 / 安全

- 不联网（除非 markdown 里有 HTTP 链接 / 图片需要加载）
- 无遥测、无崩溃上报
- 不签名（首次运行 SmartScreen 会拦一下，点 "仍要运行" 即可）
- 文件读取无路径限制（v0.1 信任用户选择；v0.2 设置面板会加 scope）

## 已知限制 / v0.2 路线图

- 无完整 GUI 设置面板（目前改 `data/settings.json`）
- 仅 UTF-8 文件（v0.2 计划加 `chardetng` 自动检测）
- 大于 5MB 的 markdown 不警告（v0.2）
- 快捷键不可重绑定（v0.2）
- 无 Alt+← / Alt+→ 导航历史（v0.2）
- 不持久化窗口尺寸 / 位置 / 最大化状态（v0.2）
- `user.css` 不支持热重载（v0.2；目前改完需重启）
- Sarasa UI SC 字体目前是占位文件（0 字节），CJK 实际走系统回退
  （Win11 `Microsoft YaHei` / `Segoe UI Variable`）—— 出货前需要
  按 `src/assets/fonts/README.md` 的步骤用 `pyftsubset` 生成
  ~1.5MB 的真实 subset
- 单文件 / 单实例 / 不支持多 tab（**故意的** —— 这是阅读器不是编辑器）
- 仅 Windows（macOS / Linux v0.2 视精力而定）

## 致谢

- [react-markdown](https://github.com/remarkjs/react-markdown)
  + [remark](https://github.com/remarkjs/remark) /
  [rehype](https://github.com/rehypejs/rehype) 生态
- [Mermaid](https://mermaid.js.org/)
- [Shiki](https://shiki.style/)
- [KaTeX](https://katex.org/)
- [Tauri](https://tauri.app/)
- [svg-pan-zoom](https://github.com/ariutta/svg-pan-zoom)
- [panzoom (anvaka)](https://github.com/anvaka/panzoom)
- [Sarasa Gothic](https://github.com/be5invis/Sarasa-Gothic)（CJK 字体）

## License

TBD（开源协议待定，作者自用为主，使用前请咨询）。
