# markdown-reader

一个让 Mermaid 图能够拖动、缩放、全屏的桌面 Markdown 阅读器。

## 这个工具解决什么问题

市面上绝大多数 Markdown 阅读器把 Mermaid 渲染成一张固定大小的图片：
看不清细节、放不大、滚轮会被劫持、想全屏更没门。这个项目把 Mermaid
当成一等公民来对待：每一张图都能拖、能缩、能全屏，并且不会偷走页面
滚轮。除此之外它是一个克制的 GitHub-style 单文件 Markdown 阅读器
——默认就是阅读，不带 tab，不联网（除非你的 markdown 自带远程链接）。

从 v1.0 起新增了一个**可选的** split-view 编辑模式（`Ctrl+E`）：左边
CodeMirror 6 编辑器、右边实时预览，编辑时也能立刻看到自己写的
Mermaid 实时渲染。但定位没变——阅读优先，编辑是 opt-in，不追
Typora 那种 WYSIWYG，也不做 Obsidian 的 vault。

## 主要特性

- 行内 Mermaid 拖拽 / 缩放（Ctrl+滚轮缩放，纯滚轮滚页面 —
  修复了几乎所有竞品的滚动劫持）
- Mermaid 全屏 lightbox（光标锚定缩放）
- 图片点击全屏
- 浅色 / 深色 / 跟随系统三主题，200ms 渐变过渡
- 开箱即用的 Claude「Quiet Serif」主题：首次启动自动写入 `data/user.css` 并启用，
  内置 Source Serif 4 / Inter / JetBrains Mono + 思源宋体（Noto Serif SC）子集四款
  开源字体（OFL，随程序加载，无需安装系统字体），中英文都是衬线观感；想回到默认
  风格删掉 `data/user.css` 重启即可（不会被重新生成）
- 自定义主题：`data/user.css` 可整体换肤（阅读 + 编辑器 chrome + 语法 +
  滚动条都跟随）；主题源文件 `theme/claude.user.css`，开发指南见
  [`docs/theming.md`](docs/theming.md)
- 标题栏页面缩放按钮（阅读模式，− / 百分比 / +，点百分比复位）+
  状态感知的最大化/还原图标
- 文件内 Ctrl+F 搜索（支持大小写 / 整词 / 正则；跳过代码块外的
  Mermaid SVG 与 KaTeX 公式）
- 自动 TOC 右侧栏，跟随当前阅读区域高亮
- 拖拽打开 + 最近 10 文件 + Windows 文件关联
- 外部编辑器保存自动重载（保留滚动位置）
- 保存采用原子写（写临时文件再替换），崩溃 / 断电不会损坏正在保存的文件
- 链接路由：HTTP → 系统浏览器 / 本地 .md → 当前窗口 /
  其他本地文件 → 系统默认应用
- 打印（强制亮色 + 隐藏 chrome + 代码自动换行 + 链接 URL 追加）
- 右键菜单（复制链接 / 图片 / Mermaid 为图片）
- 滚动位置 / 主题 / 页面缩放 / TOC 显隐 / 窗口大小位置与最大化状态 持久化
- 便携安装：数据目录就在程序目录下的 `data/`，删除安装目录即清理干净
- **（v1.0）可选 split-view 编辑模式**：CodeMirror 6 + 实时预览 +
  双向行高亮联动 + 滚动同步 + Markdown 语法高亮（双主题）+ 拖拽分隔条

## 编辑模式（v1.0）

默认进阅读模式。按 `Ctrl+E`（或点标题栏的 ✏️ 按钮）切到编辑模式：

- **布局**：自适应 split view —— 窗口宽 > 900px 时左右分栏（左编辑 /
  右预览），≤ 900px 时上下分栏。中间分隔条可拖拽改比例（每栏 ≥ 200px），
  比例持久化。
- **实时预览**：输入后 500ms 防抖刷新右侧预览；Mermaid / KaTeX / 代码
  高亮等阅读模式的招牌特性在预览侧完全保留。
- **滚动同步**：编辑光标移动 → 预览自动把对应块滚到视口上方约 1/4 处（单向，避免
  循环；可在 `settings.editor.scrollSync` 关闭）。
- **行高亮联动**（双向）：点编辑器某一行 → 预览里对应块描边闪一下；点预览
  里某个块 → 编辑器光标跳到对应源码行并闪一下。段落、标题、列表、引用、
  **代码块、表格、Mermaid 图**都支持（点链接 / 图片 / 工具栏按钮不触发，
  不影响它们各自的行为）。
- **语法高亮**：GitHub 风格双主题（跟随 app 主题切换，光标位置保留），
  标题彩色、加粗加重、行内代码等宽；编辑器内还高亮 LaTeX 数学
  （`$…$` / `$$…$$`）与 Mermaid 图源码。
- **保存**：`Ctrl+S` 显式保存（弹「已保存」提示）；切回阅读模式时若有
  未保存改动会**静默自动保存**。标题栏文件名前的 `●` 表示有未保存改动。
- **新建 / 另存**：`Ctrl+N` 新建未命名文档并进入编辑；`Ctrl+Shift+S`
  另存为；未命名文档首次 `Ctrl+S` 会弹保存对话框（强制 `.md` 后缀）。
- **冲突保护**：编辑且有未保存改动时，若文件被外部程序修改，会弹提示让你
  选择「重载（丢弃我的修改）」或「保留我的修改」，不会静默覆盖。
- **关闭保护**：`Ctrl+W` / `Ctrl+Q` / 点 ✕ 时若有未保存改动，会弹
  三选项确认框（放弃 / 取消 / 保存并继续）。

编辑相关的设置写在 `data/settings.json` 的 `editor` 子对象 + `splitRatio`
字段里（v1.0 暂无 GUI 设置面板，需手动编辑；从 v0.1 升级会自动补全这些
字段）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `splitRatio` | `0.5` | 编辑/预览分栏比例（0.2–0.8） |
| `editor.defaultMode` | `"read"` | 启动默认模式（`"read"` / `"edit"`） |
| `editor.scrollSync` | `true` | 编辑→预览滚动同步开关 |
| `editor.lineNumbers` | `false` | 编辑器行号 |
| `editor.lineWrap` | `true` | 编辑器软换行 |
| `editor.tabSize` | `2` | 缩进宽度 |
| `editor.autoSave` | `false` | 后台自动保存（v1.0 不启用） |

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

> 首次运行时 Windows SmartScreen 会拦一下（没有代码签名），
> 点 "更多信息" → "仍要运行" 即可。这是个人项目的预期行为。

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
pnpm test         # 单元测试（Vitest）
pnpm tauri build  # 构建 release（生成 NSIS .exe + MSI 到 src-tauri/target/release/bundle/）
```

构建产物：
- `src-tauri/target/release/bundle/nsis/markdown-reader_x.y.z_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/markdown-reader_x.y.z_x64_en-US.msi`

### 持续集成 / 发版

- `.github/workflows/check.yml`：push 到 main / PR 时跑 `tsc` + `pnpm test` +
  `vite build`（不构建 Tauri，快）。
- `.github/workflows/release.yml`：推送 `v*` tag 时在 Windows 上 `tauri build`
  并自动发 GitHub Release、上传 NSIS + MSI —— 保证发布的安装包就是 CI 构建的那个。
  发版只需 `git tag vX.Y.Z && git push origin vX.Y.Z`。

## 数据目录

app 把所有持久化数据放在**安装目录下的 `data/` 子文件夹**。这意味着
卸载只需要删掉整个安装目录，不会有遗留文件散落在 AppData。

文件清单：

| 文件 | 用途 |
|---|---|
| `settings.json` | 主题模式、页面缩放、TOC 默认显隐、编辑器设置（`editor.*` / `splitRatio`，见上方「编辑模式」） |
| `recent.json` | 最近 10 文件（LRU、去重） |
| `scroll-positions.json` | 每文件滚动位置（LRU 100） |
| `window.json` | 窗口尺寸 / 位置 / 最大化状态（启动时恢复） |
| `user.css` | 用户自定义样式（启动时一次性加载，写在 `<head>` 最末）；首次运行自动写入 Claude 主题，删除后重启不再重建 |
| `.theme-seeded` | 标记 Claude 主题已播种过一次（删 `user.css` 后据此不再重建，尊重用户选择） |
| `logs/app.log` | 滚动日志（5MB 上限 + 7 天保留 `.bak`） |

> 仍无 GUI 设置面板，要改主题以外的设置（页面缩放区间、默认显示 TOC、
> 编辑器选项等）请直接编辑 `data/settings.json`。完整的 GUI 设置面板
> 规划在后续版本。

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
| `Ctrl+E` | 切换阅读 / 编辑模式（v1.0） |
| `Ctrl+N` | 新建文档并进入编辑（v1.0） |
| `Ctrl+滚轮`（在 Mermaid 图上） | 缩放图（不滚页面） |

编辑模式专属（v1.0）：

| 快捷键 | 行为 |
|---|---|
| `Ctrl+S` | 保存（未命名文档会弹保存对话框） |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+B` / `Ctrl+I` | 加粗 / 斜体选区 |
| `Ctrl+K` / `Ctrl+Shift+K` | 插入链接 / 图片（占位符自动选中，直接打字填 URL） |
| `Ctrl+F` | 编辑器内查找（CodeMirror 搜索面板，阅读模式仍是浮窗搜索） |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Tab` / `Shift+Tab` | 增加 / 减少缩进 |

快捷键 v1.0 仍不可重绑定。

## 隐私 / 安全

- 不联网（除非 markdown 里有 HTTP 链接 / 图片需要加载）
- 无遥测、无崩溃上报
- 不签名（首次运行 SmartScreen 会拦一下，点 "仍要运行" 即可）
- 文件读取无路径限制（v0.1 信任用户选择；v0.2 设置面板会加 scope）

## 已知限制 / 后续路线图

- 无完整 GUI 设置面板（目前改 `data/settings.json`）
- 仅 UTF-8 文件（计划加 `chardetng` 自动检测）
- 大于 5MB 的 markdown 不警告（计划中）
- 快捷键不可重绑定（计划中）
- 无 Alt+← / Alt+→ 导航历史（计划中）
- `user.css` 不支持热重载（计划中；目前改完需重启）
- 无主题默认样式（删除 `data/user.css` 后）下，CJK 衬线正文会回退到系统字体
  （Win11 `Microsoft YaHei` / `Segoe UI Variable`）—— 因为占位用的
  `src/assets/fonts/sarasa-ui-sc-subset.woff2` 目前仍是 0 字节空文件。
  开箱默认的 Claude 主题不受影响：它已内置 ~8.4MB 的思源宋体
  （Noto Serif SC）子集承担 CJK 正文
- 单文件 / 单实例 / 不支持多 tab（**故意的** —— 阅读优先；v1.0 的编辑
  模式也是单文档，不开多 tab 编辑）
- 编辑模式不做 WYSIWYG / vault / wikilink / 协同编辑（**故意的**，不在
  本项目定位内）
- 仅 Windows（macOS / Linux 视精力而定）

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
- Claude 主题内置字体（均 SIL OFL-1.1）：
  [Source Serif 4](https://github.com/adobe-fonts/source-serif)、
  [Inter](https://github.com/rsms/inter)、
  [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)、
  [Noto Serif SC / Source Han Serif](https://github.com/notofonts/noto-cjk)

## License

TBD（开源协议待定，作者自用为主，使用前请咨询）。
