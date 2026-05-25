# 主题开发指南（编写 `user.css`）

本软件不内置主题市场，但提供了一个**单文件自定义样式入口** `data/user.css`，配合一套统一的 CSS 变量（设计令牌），你可以把整个界面——阅读区、编辑器、滚动条——换成任意风格。仓库里的 `theme/claude.user.css`（Claude「Quiet Serif」风格）就是用这套机制做的，可作为完整范例对照。

---

## 1. 快速开始

1. 在**安装目录**下找到 `data/` 文件夹（便携布局，数据就在程序旁边）。
2. 在里面新建一个文件，**文件名必须正好是 `user.css`**（`<安装目录>/data/user.css`）。
   > ⚠️ 最常见的坑：放成了 `mytheme.css` / `claude.user.css` 之类——**不生效**。app 只读 `user.css` 这一个确切文件名。
3. 写入你的 CSS，**完全退出并重启** app。

### 加载机制（务必了解）

- `user.css` 在**启动时一次性读取**，作为 `<style>` 注入到 `<head>` **最末尾**。
- 因为在最后，它的优先级在同特异性下**胜过**内置样式（`github-markdown-css` 和 app 自带的 `theme.*.css`）——所以**大多数情况不需要 `!important`**。
- **没有热重载**：改完 `user.css` 必须重启 app 才生效。
- **首次运行自动播种**：若 `user.css` 不存在且从未播种过，app 会把内置的 Claude「Quiet Serif」主题（`theme/claude.user.css` 的内容）写入 `data/user.css` 并启用，同时写一个 `data/.theme-seeded` 标记。所以全新安装开箱即是 Claude 风。
- **想回默认风格**：删掉 `data/user.css` 重启即可——`.theme-seeded` 标记会阻止它被重新生成（尊重你的删除）。想换自己的主题就直接覆盖 `user.css` 内容（已存在的文件**永不**被自动覆盖）。

### 开发时调试

源码开发模式（`pnpm tauri dev`）的数据目录在 `src-tauri/target/debug/data/`；把 `user.css` 放那儿即可。改完仍需重启 dev 实例（无热重载）。

---

## 2. 推荐做法：先改「设计令牌」，再补「元素规则」

整个 app 的配色都走 CSS 自定义属性（定义在 `src/styles/theme.light.css` / `theme.dark.css`）。**重定义这些令牌**就能让 app chrome、代码块、frontmatter、mermaid 容器、强调色、甚至编辑器**一次性整体换肤**。然后再对少数元素（正文字体、标题、表格等）写具体规则即可。

### 2.1 亮 / 暗双色怎么写

主题通过 `<html data-theme="light">` / `<html data-theme="dark">` 切换（「跟随系统」会解析成其一）。所以：

```css
/* 亮色（:root 兜底首帧 + 显式 light） */
:root,
:root[data-theme='light'] {
  --bg-canvas: #faf9f5;
  /* … */
}

/* 暗色 */
:root[data-theme='dark'] {
  --bg-canvas: #262624;
  /* … */
}
```

### 2.2 核心调色板令牌（改这些就能整体换肤）

| 令牌 | 作用 |
|---|---|
| `--bg-canvas` | 主滚动区 / 正文背景 |
| `--bg-app` | 应用外壳背景 |
| `--bg-surface` | 标题栏、状态栏等面板 |
| `--bg-elevated` | 卡片 / 弹层 |
| `--bg-hover` / `--bg-active` | 悬停 / 激活面 |
| `--bg-code-block` | 代码块背景 |
| `--fg-default` | 正文 / chrome 主文字 |
| `--fg-muted` / `--fg-subtle` | 次级 / 三级文字 |
| `--fg-on-accent` | 强调色按钮上的文字 |
| `--fg-link` / `--fg-link-hover` | 链接色 / 悬停色 |
| `--border-default` / `--border-muted` / `--border-strong` | 三档边框 |
| `--accent` / `--accent-bg-soft` | 强调色（focus ring、拖拽高亮、按钮等） |
| `--bg-codeblock-toolbar` / `--bg-codeblock-toolbar-hover` / `--fg-codeblock-lang` | 代码块工具栏（语言标签 / 复制按钮） |
| `--bg-frontmatter` / `--bg-frontmatter-body` | YAML frontmatter 卡片 |
| `--bg-mermaid-container` / `--bg-mermaid-toolbar` | Mermaid 容器 / 工具栏 |
| `--btn-bg` / `--btn-bg-hover` / `--btn-bg-active` / `--logo-bg` | 空状态按钮 / Logo |

完整列表见 `src/styles/theme.light.css`（每个都有注释）。

### 2.3 `github-markdown-css` 的变量

正文 `<article class="markdown-body">` 的底层排版来自 `github-markdown-css`，它自己有一套变量。app 在 `.markdown-body` 上覆盖了它们，你可以接着覆盖：

```css
:root[data-theme='light'] .markdown-body {
  --bgColor-default: #faf9f5;
  --bgColor-muted: #f0eee6;
  --fgColor-default: #141413;
  --fgColor-muted: #3d3d3a;
  --fgColor-accent: #d97757;
  --borderColor-default: #1f1e1d4d;
  --borderColor-muted: #1f1e1d26;
}
```

---

## 3. 正文内容元素（`.markdown-body`）

阅读区是 `<article class="markdown-body">` + 标准 HTML 元素（`h1`–`h6` / `p` / `pre` / `table` / `blockquote` / `a` / `img` …）。常见可调点：

```css
/* 字体 + 页宽 */
.markdown-body { font-family: Georgia, serif; max-width: 752px; line-height: 1.7; }

/* 标题：去掉 github 的 h1/h2 下划线、自定字号 */
.markdown-body h1, .markdown-body h2 { border-bottom: none; padding-bottom: 0; }

/* 链接 */
.markdown-body a { color: inherit; text-decoration: underline; }
.markdown-body a:hover { color: var(--accent); }

/* 行内代码（注意排除代码块里的 code，见 §4） */
.markdown-body code { color: #8a2424; background: rgba(61,61,58,.05); border-radius: .4rem; padding: 1px .3rem; }

/* 引用 / 分隔线 */
.markdown-body blockquote { border-left: 4px solid var(--border-muted); color: var(--fg-muted); }
.markdown-body hr { border: 0; border-top: 1px solid var(--border-default); }

/* 表格：去外框 + 仅横向细线（举例） */
.markdown-body table th, .markdown-body table td { border: none; border-bottom: 1px solid var(--border-default); }
```

### GitHub 警告框 / Callout

用的是 `remark-github-blockquote-alert`，类名为 `.markdown-alert` + `.markdown-alert-note|tip|important|warning|caution`，标题是 `.markdown-alert-title`：

```css
.markdown-body .markdown-alert { border-radius: 8px; border-left: 3px solid var(--alert-accent); background: var(--alert-bg); }
.markdown-body .markdown-alert-note { --alert-accent: #5d7d9a; --alert-bg: rgba(93,125,154,.10); }
/* …其余类型同理 */
```

### Frontmatter

YAML frontmatter 是一个可折叠的 `<details>`，正文 `<pre>` 带稳定属性 `[data-frontmatter-body]`，可据此定制：

```css
.markdown-body [data-frontmatter-body] { background: var(--bg-frontmatter-body); }
```

---

## 4. 代码高亮（两套，分清楚）

本软件**预览**和**编辑器**用的是**两套不同的高亮**：

### 4.1 预览（右侧渲染）= Shiki
预览里的围栏代码由 **Shiki** 渲染，每个 token 的颜色来自行内 CSS 变量，由这条规则上色：
```
.markdown-body pre code span { color: var(--shiki-light) !important }   /* 暗色为 --shiki-dark */
```
**这套 token 配色不在 `user.css` 的常规掌控范围内**（Shiki 主题决定）。你可以改代码块**容器**（背景/边框/圆角，见 `--bg-code-block`），但要改语法 **token 配色**得动 app 源码里的 Shiki 主题，不是写 `user.css` 能搞定的。

> 注意：`.markdown-body pre code { … }` 只会影响代码块的「非 span」文字；真正的 token 在 `span` 上且带 `!important`，你的 `user.css` 普通规则盖不动它。

### 4.2 编辑器（左侧 CodeMirror）= `--cm-*` 令牌

编辑器的 **markdown 语法配色**走一组 `--cm-*` 令牌，重定义即可换色（亮/暗分别写）：

| 令牌 | 含义 |
|---|---|
| `--cm-heading` / `--cm-heading-sub` | 标题（h1-2 / h3-6） |
| `--cm-strong` | 加粗 |
| `--cm-strikethrough` | 删除线 |
| `--cm-link` | 链接 / URL |
| `--cm-code` | 行内 / 围栏代码（monospace） |
| `--cm-quote` | 引用 |
| `--cm-list` | 列表标记 |
| `--cm-marker` | 语法符号（`#` `*` 等） |
| `--cm-label` | 代码语言名 / 链接 label |
| `--cm-string` | 链接标题等字符串 |
| `--cm-separator` | 分隔线 |

编辑器里围栏代码块（```js / ```python …）的**语言级语法高亮**用的是 CodeMirror 的内置高亮（亮色 `defaultHighlightStyle`、暗色 one-dark），不通过 `--cm-*`，目前不暴露给 `user.css`。编辑器的背景/光标/选区/行号等 **chrome** 则跟随上面 §2.2 的调色板令牌（`--bg-canvas` / `--fg-default` / `--accent` / `--bg-hover` 等），所以你改了调色板，编辑器外观会一起变。

---

## 5. 滚动条

WebView2 是 Chromium 内核，用 `::-webkit-scrollbar` 即可（会同时作用于阅读区与编辑器的滚动条）：

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(95,75,55,.32); border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: rgba(95,75,55,.55); }
```

---

## 6. 字体

`user.css` 自身不打包字体，但 **app 本体已内置 4 款开源字体（SIL OFL-1.1）**，通过 `src/styles/fonts.css` 的 `@font-face` 从程序自身加载（`'self'` 源，无需联网、无需装系统字体）。你的 `user.css` 可**直接按族名引用**它们：

| 族名 | 角色 |
|---|---|
| `Source Serif 4` | 英文衬线正文 |
| `Inter` | 无衬线 / chrome |
| `JetBrains Mono` | 等宽代码 |
| `Noto Serif SC` | **中文衬线正文**（子集，约 8.4MB） |

```css
/* 直接用内置字体，开箱即有；前面可再放系统专有字体作首选，没装会自动落到内置 */
.markdown-body { font-family: "Source Serif 4", "Noto Serif SC", Georgia, serif; }
```

要用**其它**自定义字体（不在上面四款内），仍需先把字体**安装到系统**，再按族名引用，并留好回退链：

```css
.markdown-body { font-family: "Your Serif", "Source Serif 4", Georgia, "Noto Serif SC", serif; }
```

> 想再内置新字体（而非装系统）：把 woff2 放进 `src/assets/fonts/`、在 `src/styles/fonts.css` 加一条 `@font-face`，Vite 会自动指纹化打包——见 `src/assets/fonts/README.md`。

---

## 7. 已知限制 / 坑

- 文件名必须是 `user.css`（§1）。
- 无热重载，改完要重启。
- **Mermaid 图**是渲染后的 SVG，无法做「语法高亮」；其容器可调色（`--bg-mermaid-container`）。
- 预览代码 **token 配色**由 Shiki 控制，`user.css` 改不动（§4.1）。
- 打印走强制亮色 + 隐藏 chrome 的 `@media print`，主题在打印时大部分被覆盖。

---

## 8. 最小可用模板

```css
/* <安装目录>/data/user.css */
:root, :root[data-theme='light'] {
  --bg-canvas: #fffdf7;
  --fg-default: #2b2b2b;
  --accent: #c25b3a;
}
:root[data-theme='dark'] {
  --bg-canvas: #1c1b19;
  --fg-default: #ece8df;
  --accent: #e08a63;
}
.markdown-body { font-family: Georgia, "Noto Serif SC", serif; max-width: 760px; }
.markdown-body a:hover { color: var(--accent); }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,.28); border-radius: 8px; }
```

---

## 9. 完整范例

仓库内 `theme/claude.user.css` 是一套完整、可直接用的主题（Claude「Quiet Serif」风格），覆盖了本指南提到的所有方面（令牌、正文、callout、frontmatter、`--cm-*`、滚动条）。照着改最省事。
