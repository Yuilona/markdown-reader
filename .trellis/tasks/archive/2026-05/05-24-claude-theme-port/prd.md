# Port "Quiet Serif (Claude)" Typora theme to markdown-reader

## Goal

把用户放在 `theme/主题V14.0.zip` 里的个人 Typora 主题「Quiet Serif / 静衬线」（极致还原 Claude 风格）在本项目里做一个**效果尽量一致**的版本。

## What I already know

- 主题文件：`theme/_extracted/claude.css`（亮，~103KB）、`claude-dark.css`（暗，~100KB）+ 三套字体（思源中文衬线、Anthropic 英文 sans/serif、书信体）+ README。
- 设计令牌（亮）：
  - 底 `#faf9f5`、字 `#141413`、边框 `#1f1e1d`（+ 0.15/0.30 透明度档）
  - Claude 橙 `--LOGO-color #D97757`、hover `#a94f2d`、focus ring 同橙
  - 行内代码字色 `#8a2424`、代码块底 `#3d3d3a0d` / 边 `#1f1e1d26`、pre 底 `#ffffff80`
  - 引用字 `#3d3d3a` / 边 `#1f1e1d1a`；表格 th 边 `#1f1e1d99` / td 边 `#1f1e1d4d`；hr `#1f1e1d4d`
  - 字体：serif `"Anthropic Serif Web Text", Georgia, …, "Noto Serif SC"`；sans `"Anthropic Sans Web Text", …`；mono `"Anthropic Mono Variable", …`；正文 weight 400 / strong 700；圆角 8/12/20
  - Callout/alert 5+ 色（note/tip/warning/caution/important…）、YAML 适配
  - 页宽 ≈ 678px；暗色「加粗用颜色而非字重」；高亮改下波浪线
- 本项目内容 DOM：`<article class="markdown-body">` + 标准元素，基底是 `github-markdown-css`；亮/暗靠 `<html data-theme>` 切换；自定义样式入口是 `data/user.css`（启动一次性加载、追加到 `<head>` 末尾、覆盖力最强、无热重载）。
- 代码高亮是 **Shiki**（token 颜色来自 Shiki 主题的行内样式，不在 `.markdown-body` 的 CSS 控制范围内）；Mermaid/KaTeX 为本项目自有渲染。

## Open Questions（待确认 —— 见 Decision 表）

## Requirements（evolving）

- R1 产出一份适配本项目 DOM 的主题 CSS：把 Typora 的 `#write` / `.md-*` 选择器重映射到 `.markdown-body` + 标准元素；覆盖 `github-markdown-css` 基底。
- R2 亮/暗双色，跟随本项目 `[data-theme='light'|'dark']`（含 system 解析后的实际值）。
- R3 覆盖内容元素：正文排版、h1–h6、段落、列表、引用、`hr`、链接、表格、行内代码、代码块容器、图片、GitHub-alert（callout）、YAML frontmatter 卡片。
- R4 字体引用主题自带字体族名（serif/sans/mono），并说明需安装字体；缺字体时回退链可用。
- R5 页宽向主题靠拢（~678px，覆盖本项目 `.article` 的 820px）。

## Acceptance Criteria — 用户已肉眼验收通过（"效果很好"）

- [x] 放入 `data/user.css` 后，阅读 + 编辑预览呈现 Claude 暖纸/衬线观感（底色、字色、橙色强调、衬线正文）
- [x] 亮/暗切换（Ctrl+T）配色都正确
- [x] 代码块容器、表格、引用、callout、链接、hr 与主题一致；行内代码红字
- [x] 不破坏 Mermaid pan/zoom、KaTeX、搜索高亮、行高亮联动
- [x] 编辑器也跟随主题：chrome（底/文字/光标/选区/行号）+ markdown 语法配色（`--cm-*` 暖色）+ 滚动条
- 交付：`theme/claude.user.css`（入库）；app 侧令牌化改动 commits `da6d883`（chrome）+ `4d305cc`（syntax）。
  字体需用户自装；代码 Shiki token 配色与「做旧纸卡 YAML」仍按 Out of Scope 保留近似。

## Out of Scope

- Typora 软件 chrome（侧边栏 / 文件树 / 设置界面 / 源码模式）——本项目无这些
- 代码 **token 配色**与 Claude 完全一致（受 Shiki 主题控制，非 `.markdown-body` CSS 能改；除非另做 app 级 Shiki 主题切换 —— 见 Decision D3）
- 把 85MB 字体打进 app 安装包
- 像素级完全一致保证（DOM 不同 + 无法渲染比对，目标是高保真）

## Decision (ADR-lite) — 已确认（用户「都行」全采纳推荐）

| # | 主题 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 交付方式 | A `data/user.css` 拖入（无需改 app、无需重新发版）/ B 内置为可选主题（改 app + 主题选择器 + 打包/引用字体，工程量大） | **A user.css** |
| D2 | 字体 | 用户自行安装主题自带字体（CSS 用字体族名引用）/ 把字体随 user.css 一起 base64 内嵌（体积大） | **用户安装 + 族名引用** |
| D3 | 代码 token 配色 | 仅匹配代码块容器（底/边/圆角/字体），token 颜色保持 Shiki / 另做 app 级 Claude Shiki 主题（更大改动） | **仅容器**（token 配色列入 Out of Scope，可后续单独做） |
| D4 | 实施 | 单 PR 出 `user.css` | **单 PR**，先 research 提取设计再写 |
