# Markdown Reader — 项目说明（给 AI 助手）

Tauri 2 + React 18 的桌面 Markdown 阅读器（附带编辑），主要面向 Windows。
用户文档见 `README.md`，主题定制见 `docs/theming.md`。

## 技术栈

- 前端：React 18 + TypeScript + Vite 5，CSS Modules；测试 Vitest（部分用 jsdom）
- 渲染：react-markdown，remark-gfm / remark-math / remark-github-blockquote-alert
  → rehype-raw → rehype-sanitize → 自定义插件 → rehype-slug / KaTeX / Shiki；
  Mermaid 懒加载（svg-pan-zoom）
- 编辑器：CodeMirror 6（@uiw/react-codemirror）
- 后端：Rust（`src-tauri/`），插件 dialog / fs / shell，单实例、文件监听，
  chardetng + encoding_rs 做编码检测

## 目录

```
src/
  App.tsx                应用外壳：打开文档、导航历史、快捷键、设置面板
  components/            UI 组件（每个一个目录，组件 + .module.css）
    DocumentView/          Markdown 渲染管线入口
    EditModeProvider/      阅读/编辑模式、保存、脏状态
    SettingsPanel/ Titlebar/ Toc/ StatusBar/ Mermaid/ Search/ …
  hooks/                 useShortcuts、useDirtyGuard、useSettings、useWindowStatePersistence …
  lib/                   纯逻辑 + Tauri 封装，测试 *.test.ts 与源码同目录
    tauri.ts               所有 invoke 调用的唯一入口
    settings.ts / settingsStore.ts   settings.json 结构 + 带写队列和订阅的 store
    sanitizeSchema.ts      rehype-sanitize 白名单
    userCss.ts / themeFingerprint.ts 内置主题播种与自动升级
    navHistory.ts windowState.ts textStats.ts …
  styles/                全局样式、浅/深色主题变量、字体、打印
src-tauri/src/
  lib.rs                 命令注册与插件初始化
  data_dir.rs            数据目录解析
  text_codec.rs          编码检测、读写（原子写入）
  file_watcher.rs
theme/claude.user.css    内置 Claude 主题（构建时以 ?raw 内联）
.github/workflows/       check.yml（tsc+vitest+build / cargo test）、release.yml
```

## 常用命令

```bash
pnpm install
pnpm tauri dev           # 开发运行
pnpm test                # Vitest
pnpm build               # tsc -b + vite build（CI 同款检查）
cd src-tauri && cargo test
pnpm tauri build         # 本地打 release 包
```

## 关键约定

- **数据目录**：Windows 为便携布局 `<安装目录>/data/`（settings.json、recent.json、
  scroll-positions.json、window.json、user.css、.theme-seeded）；macOS/Linux 用系统
  app data 目录。不要写到 AppData。
- **切换文档**一律走 App 里带脏检查的入口（`requestOpen` / `navigateTo`，内部用
  `useDirtyGuard`），拖放、二次启动、命令行、链接、Ctrl+O、前进后退都不例外。
- **设置**：写用 `settingsStore` 的 `updateSettings` / `updateEditorSettings`（写队列，
  连续修改不丢），读和订阅用 `useSettings`，改动即时生效。
- **HTML 白名单**：要在渲染结果里保留新的 class / 元素，需在 `sanitizeSchema.ts`
  放行，或像 `rehypeAlertIcons.ts` 那样在 sanitize 之后再加。
- **页面缩放**通过 `body { zoom }` 实现，标题栏、弹窗等外壳用 `--page-zoom-inv`
  反向缩放；新加的浮层要同样处理。
- **内置主题**：改 `theme/claude.user.css` 后无需额外操作——用户未改动过的
  user.css 会按 `.theme-seeded` 里的指纹自动升级；用户改过的永不覆盖。
- **编码**：读写文档走 `read_document` / `write_document`，保持原编码与 BOM；
  无法用原编码表示时回退 UTF-8 并提示。
- **代码风格**：代码和注释用英文，面向用户的界面文字用中文；注释偏多，解释"为什么"。

## 注意事项

- 仓库 `core.autocrlf=true`。源码里不要出现字面 NUL 字符（git 会当成二进制文件），
  用 `\u0000` 转义。
- `theme/` 下的 zip、`_extracted/`、`主题V14.0/` 以及 `docs/personal-build-anthropic-fonts.md`、
  部分字体文件含专有字体，已在 `.gitignore` 中，**绝不能提交**。

## 提交与发版

- 提交信息用 Conventional Commits：`feat(scope): …`、`fix(scope): …`、`style(ui): …`、
  `ci: …`、`chore(release): bump version to x.y.z`。
- 升版本要同步改 4 处：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、
  `src-tauri/tauri.conf.json`，单独一个 bump 提交。
- 发版：推送 `vX.Y.Z` 标签 → `release.yml` 在 Windows / macOS（universal）/ Ubuntu
  上构建并发布 GitHub Release（标签含 `-` 则为预发布）。上传资产偶尔因 GitHub 端
  错误（如 "Error creating policy"）失败，`gh run rerun <id> --failed` 重跑即可。
