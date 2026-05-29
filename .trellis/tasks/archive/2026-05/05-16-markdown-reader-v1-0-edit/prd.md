# Markdown Reader v1.0 — split-view edit mode (CodeMirror 6)

## Goal

v0.1 是一个**克制的阅读器**——`R3.9` 强调过 task list checkbox 故意不可点、PRD 全文反复说"this is a reader, not an editor"。v1.0 在不破坏这个定位的前提下，加一个**可选的编辑模式**：

- 默认仍然是阅读
- 显式切换（按钮 + `Ctrl+E`）进入 **split view**：左 CodeMirror 6 编辑器 + 右现有 react-markdown 预览
- 实时 preview（500ms debounce）+ 滚动同步
- `Ctrl+S` 显式保存；切回阅读时静默 auto-save
- Mermaid pan/zoom 等 v0.1 招牌特性在预览侧完全保留

不追 Typora 那种 WYSIWYG（属于走法 B，v2.0+）。
不追 Obsidian 的 vault / wikilink（属于走法 C，可能永远不做）。

## Background

v0.1 发布后用户提出：现在貌似还不能编辑，想要对标 Typora 和 Obsidian 那种。

经过设计访谈，**确定走法 A**（保留 reader 定位 + 加 split-view 编辑），不走 B（WYSIWYG）和 C（vault）。走法 A 的差异化卖点仍然是"reader 的 Mermaid 体验最好" + "编辑时也能立刻看到自己写的 Mermaid 实时渲染"。

---

## Requirements

### R-EDIT-1 编辑器内核

* **R-EDIT-1.1** CodeMirror 6（`@uiw/react-codemirror` + `@codemirror/lang-markdown` + `@codemirror/theme-one-dark` 或自定义 github 主题对）。
* **R-EDIT-1.2** Lazy-load：只在用户首次切到编辑模式时 `import()` CM6 chunk（目标 < 200 KB gzip）。主 bundle 不受影响。
* **R-EDIT-1.3** 不装 vim mode。
* **R-EDIT-1.4** Markdown 语法高亮（`# heading` / `**bold**` / `` ` `` 等视觉区分）。
* **R-EDIT-1.5** 多光标 / 批量编辑（CM6 默认）。
* **R-EDIT-1.6** Bracket matching + code fence auto-close（` ``` ` 自动配对）。
* **R-EDIT-1.7** 智能列表延续：在 `- item` 行按 Enter 自动补 `- `。空 list item 按 Enter 退出 list。

### R-EDIT-2 布局

* **R-EDIT-2.1** 自适应 split view：
  - 视口宽 > 900 px → 横向 split（左编辑 / 右预览）
  - 视口宽 ≤ 900 px → 纵向 split（上编辑 / 下预览）
* **R-EDIT-2.2** 拖拽分隔条改两栏比例。最小约束：每栏 ≥ 200 px。
* **R-EDIT-2.3** 比例持久化到 `settings.splitRatio`（默认 0.5）。
* **R-EDIT-2.4** 编辑模式下 TOC 侧栏**自动隐藏**；切回阅读自动恢复（不写持久化，临时态）。
* **R-EDIT-2.5** Ctrl+F 在编辑模式走 CodeMirror 6 的 search panel；阅读模式仍走 PR-7 的浮窗搜索。
* **R-EDIT-2.6** Status bar 编辑模式扩展：右侧加 `行:列 · N 字 · ●未保存/✓已保存`。

### R-EDIT-3 模式切换

* **R-EDIT-3.1** 默认进 **阅读模式**（不破坏 v0.1 入口体验）。
* **R-EDIT-3.2** 切换入口：
  - 标题栏新增 ✏️ / 👁 图标按钮（在主题切换按钮左边）
  - 快捷键 `Ctrl+E`（VS Code 同款）
* **R-EDIT-3.3** 切到编辑：组件展开 split view，CM6 lazy-load + 初始化。
* **R-EDIT-3.4** 切回阅读：如有 dirty 改动 → 自动保存（**静默**，不弹 toast）；编辑器卸载（CM6 内核留在内存供下次重用）。
* **R-EDIT-3.5** `settings.editor.defaultMode` 字段允许用户改默认（`'read'` | `'edit'`），默认 `'read'`。

### R-EDIT-4 实时预览 & 滚动同步

* **R-EDIT-4.1** 编辑器内容变化 → 500 ms debounce → 触发右侧 react-markdown 重新渲染。
* **R-EDIT-4.2** 滚动同步（双向）：
  - 编辑光标行变化 → 预览滚动到对应章节/位置
  - 预览滚动 → 不反向同步编辑（避免循环）
* **R-EDIT-4.3** 滚动同步通过"line → preview-element"映射：rehype 阶段给每个块级元素加 `data-source-line="N"` 属性，scroll sync 时按行号查最近元素 → `scrollIntoView({ block: 'start' })`。
* **R-EDIT-4.4** Mermaid / KaTeX / 大图等异步布局元素：使用 IntersectionObserver 而不是固定 offset 计算，避免抖动。
* **R-EDIT-4.5** 滚动同步开关：`settings.editor.scrollSync`（默认 `true`）。

### R-EDIT-5 保存 & dirty 跟踪

* **R-EDIT-5.1** 显式保存：`Ctrl+S` 写盘 + 显示"已保存" toast（success variant，2s 自消）。
* **R-EDIT-5.2** 切回阅读模式时如有 dirty 改动 → **自动静默保存**（不显示 toast，避免每次切换刷屏）。
* **R-EDIT-5.3** Dirty 状态视觉指示：
  - 标题栏中央文件名前加 `●` 前缀
  - Status bar 右侧 `●未保存` / `✓已保存`
* **R-EDIT-5.4** 关闭操作的 dirty 保护：
  - `Ctrl+W` 关闭文件、`Ctrl+Q` 退出、点窗口 ✕ 时如有 dirty → 弹 confirm 对话框："有未保存的修改，是否放弃？" [放弃] [取消] [保存并继续]
  - `window.beforeunload` 兜底
* **R-EDIT-5.5** `settings.editor.autoSave: false`（默认）— v1.0 不做后台自动保存。仅 Ctrl+S + 切模式保存两条路径。

### R-EDIT-6 新建 & 另存为

* **R-EDIT-6.1** `Ctrl+N` 新建未命名 buffer：
  - 创建一个 `{ path: null, text: '', dirty: true }` 的 doc
  - 自动进入编辑模式
  - 标题栏显示 `● 未命名文档`
  - 关闭未保存的新建 buffer 走 dirty 保护流程（同 R-EDIT-5.4）
* **R-EDIT-6.2** `Ctrl+S` 在未命名 buffer 上 → 弹 `dialog.save()` 选保存位置，**强制 `.md` 后缀**（如用户没加自动补），写盘成功后 `path` 设置为新路径，启动 file watcher。
* **R-EDIT-6.3** `Ctrl+Shift+S` 另存为：弹 `dialog.save()` 选新位置，写盘 → 切换当前 doc 的 path 到新位置，旧 watcher 停掉，新 watcher 启动。
* **R-EDIT-6.4** 新建/另存后，新文件 path 加入 recent.json（同走 PR-5a 的 loadDocument 流程）。

### R-EDIT-7 Markdown 工具快捷键（编辑模式专属）

* **R-EDIT-7.1** `Ctrl+B` 加粗选区（包裹 `**...**`，无选区时插入 `**|**` 光标居中）。
* **R-EDIT-7.2** `Ctrl+I` 斜体（同理 `*...*`）。
* **R-EDIT-7.3** `Ctrl+K` 插入链接：
  - 有选区 → 包裹 `[选中文本](url)`，弹小输入框填 url，焦点自动到 url
  - 无选区 → 弹两栏输入框 text + url
* **R-EDIT-7.4** `Ctrl+Shift+K` 插入图片：同链接但用 `![alt](src)` 语法。
* **R-EDIT-7.5** `Tab` / `Shift+Tab`：增加/减少缩进（在 list 内更智能；CM6 自带）。
* **R-EDIT-7.6** `Ctrl+Z` / `Ctrl+Y`：撤销/重做（CM6 自带）。

### R-EDIT-8 外部修改冲突处理

* **R-EDIT-8.1** v0.1 的 file watcher（PR-5b）在阅读模式下静默 reload。**编辑模式下不能静默**，否则用户正在编辑的内容会被覆盖。
* **R-EDIT-8.2** 编辑模式 + dirty + 收到外部修改事件 → 弹 toast 冲突 UI：
  - Message: "外部修改：xxx.md 已被其他程序修改，是否重载（丢弃当前编辑）？"
  - 按钮：[重载（丢弃我的修改）] [保留我的修改]
  - "保留我的修改" = 标记当前 doc 为"已落后磁盘"（next save 会覆盖磁盘）
* **R-EDIT-8.3** 编辑模式 + **不 dirty** + 收到外部修改 → 静默 reload（同阅读模式）+ 显示 info toast"外部修改已同步"
* **R-EDIT-8.4** 阅读模式收到外部修改 → 保持 v0.1 行为（静默 reload + 保留滚动位置）

### R-EDIT-9 与现有功能的交互

* **R-EDIT-9.1** Mermaid pan/zoom：在预览侧照常 work（编辑模式下也能在右栏对着图缩放/全屏）。
* **R-EDIT-9.2** Image lightbox：照常 work。
* **R-EDIT-9.3** Right-click context menu：编辑器侧用 CM6 默认右键（系统级文本编辑菜单）；预览侧仍走 PR-8 自定义菜单。
* **R-EDIT-9.4** `Ctrl+P` 打印：始终用当前预览内容（无论 read 还是 edit 模式），强制 light 主题等 v0.1 规则不变。
* **R-EDIT-9.5** `Ctrl+R` / `F5` 重载：编辑模式下如 dirty → 弹 confirm "重载会丢失当前修改，是否继续？"。
* **R-EDIT-9.6** `Ctrl+T` 切主题、`Ctrl+=/-/0` 页面缩放、`F11` 全屏：均不变。
* **R-EDIT-9.7** TOC sidebar：编辑模式自动隐藏（R-EDIT-2.4）。
* **R-EDIT-9.8** 链接路由：在预览侧按 PR-5b R7 规则；在编辑器侧文本里的 URL 不可点击（CM6 默认）。

### R-EDIT-10 EmptyState 改动

* **R-EDIT-10.1** EmptyState 加 "新建" 按钮（`Ctrl+N` 同效），放在 "打开文件" 按钮右侧。
* **R-EDIT-10.2** 拖拽提示文字微调：原 "拖拽 .md 到此处 / Ctrl+O 打开" → 改为 "拖拽 .md 到此处 / Ctrl+O 打开 / Ctrl+N 新建"。
* **R-EDIT-10.3** Recent list 行为不变。

### R-EDIT-11 主题集成

* **R-EDIT-11.1** CodeMirror 6 双主题：使用 `@codemirror/theme-one-dark` 或自写 github-light / github-dark CM6 theme extension。
* **R-EDIT-11.2** ThemeProvider 的 `effective` 变化时 → 重新挂载 CM6 编辑器使用新主题（CM6 不支持热替换主题 extension，靠 `key={effective}` 强制 remount）。
* **R-EDIT-11.3** 重新挂载时保留当前光标位置 + 滚动位置（保存 selection / scrollTop 前，挂载后恢复）。

### R-EDIT-12 Settings 新字段（写入 `data/settings.json`，v0.2 GUI 面板会暴露）

```ts
interface Settings {
  // 既有字段...
  version: 1;
  theme: 'light' | 'dark' | 'system';
  pageZoom: number;
  showTocByDefault: boolean;
  // v1.0 新增：
  splitRatio: number;            // 0.2 - 0.8，默认 0.5
  editor: {
    defaultMode: 'read' | 'edit';  // 默认 'read'
    autoSave: boolean;             // 默认 false
    scrollSync: boolean;           // 默认 true
    lineNumbers: boolean;          // 默认 false
    lineWrap: boolean;             // 默认 true
    tabSize: number;               // 默认 2
  };
}
```

* 走现有 `settingsStore.ts` 的 `updateSettings({ ... })` 接口（pre-tag 修过的串行写队列），无 race。
* 旧 settings.json（无 `editor` / `splitRatio` 字段）→ migration：读到后用默认值补全并立即写回。

---

## Acceptance Criteria

### R-EDIT-1 编辑器
* [ ] 切到编辑模式，CodeMirror 6 加载并显示当前文件内容
* [ ] Markdown 语法高亮可见（标题彩色、bold 加重、code 等宽）
* [ ] 多光标（Alt+Click 或 Ctrl+D 选下一个相同词）可用
* [ ] 智能列表：`- item` 行按 Enter → 自动补 `- `；空 list 行按 Enter → 退出 list

### R-EDIT-2 布局
* [ ] 视口 > 900 px 时横向 split；resize 到 ≤ 900 px 时变纵向 split
* [ ] 拖拽分隔条改两栏比例，最小 200 px 约束生效
* [ ] 重启 app 比例保持
* [ ] 编辑模式下 TOC 自动隐藏；切回阅读自动恢复
* [ ] 编辑模式 Ctrl+F 弹 CM6 的 search panel；阅读模式仍是原 floating bar

### R-EDIT-3 模式切换
* [ ] 默认启动是阅读模式
* [ ] 点 ✏️ 按钮或按 Ctrl+E 切到编辑
* [ ] 再按 Ctrl+E 切回阅读，如有未保存修改 → 静默自动保存

### R-EDIT-4 实时预览 / 滚动同步
* [ ] 在编辑器输入字符 → 500 ms 内右侧预览更新
* [ ] 编辑光标移到第 100 行 → 预览自动滚到该行附近章节
* [ ] 预览滚动不反向影响编辑光标

### R-EDIT-5 保存 / dirty
* [ ] Ctrl+S 写盘 + 显示"已保存" toast
* [ ] 标题栏文件名前出现 `●` 当 dirty，保存后消失
* [ ] Ctrl+W / Ctrl+Q / 关窗 ✕ 当 dirty → 弹 confirm 三选项

### R-EDIT-6 新建 / 另存
* [ ] Ctrl+N 创建未命名 buffer，进入编辑模式
* [ ] 未命名 buffer 上 Ctrl+S 弹 save dialog
* [ ] Ctrl+Shift+S 弹 save dialog 另存到新路径

### R-EDIT-7 快捷键
* [ ] Ctrl+B 加粗选区
* [ ] Ctrl+I 斜体
* [ ] Ctrl+K 弹链接输入框
* [ ] Ctrl+Shift+K 弹图片输入框

### R-EDIT-8 冲突
* [ ] 编辑 + dirty 时外部改文件 → 弹冲突 toast 含两个按钮
* [ ] "重载" 丢弃当前修改并加载磁盘内容
* [ ] "保留" 保持当前编辑，下一次 Ctrl+S 覆盖磁盘

### R-EDIT-9 与现有功能
* [ ] 编辑模式下预览侧的 Mermaid 仍能 pan/zoom + 全屏
* [ ] 编辑模式下 Ctrl+P 仍能打印（用预览内容）

### R-EDIT-10 EmptyState
* [ ] 空状态有 "新建" 按钮，点击进入编辑模式新 buffer

### R-EDIT-11 主题
* [ ] 切主题 → 编辑器配色随之切换，光标位置保留

### R-EDIT-12 Settings
* [ ] 旧 settings.json 缺 editor 字段时，启动自动补全
* [ ] 拖动 split 后 reload 比例保持

---

## Definition of Done

* AC 全勾
* `pnpm exec tsc --noEmit` clean
* `pnpm build` clean，主 bundle 仍 < 200 KB（CM6 在独立 lazy chunk，目标 < 250 KB gzip）
* `cd src-tauri && cargo check` clean（**无 Rust 改动**——v1.0 是纯 frontend）
* 手测：从 v0.1 升级路径——旧 settings.json 自动 migration，旧文件正常打开，编辑后保存能 round-trip
* trellis-check 通过
* 标 tag `v1.0.0`，发新 GitHub Release（替换 v0.1 NSIS .exe 为新版）

---

## Technical Approach

### 新增 / 修改文件清单

```
src/
├── components/
│   ├── Editor/                              # NEW
│   │   ├── CodeMirrorEditor.tsx             # CM6 wrapper, lazy-loaded
│   │   ├── CodeMirrorEditor.module.css
│   │   ├── editorExtensions.ts              # 主题 + 高亮 + 智能列表 extension
│   │   ├── markdownKeymap.ts                # Ctrl+B/I/K 等 markdown actions
│   │   └── useEditorScrollSync.ts           # 滚动同步 hook
│   ├── SplitView/                           # NEW
│   │   ├── SplitView.tsx                    # 自适应横/纵 split + 拖拽分隔条
│   │   └── SplitView.module.css
│   ├── EditModeProvider/                    # NEW (or use App state + context)
│   │   ├── EditModeProvider.tsx             # { mode, setMode, dirty, save, doc, setText }
│   │   └── useEditMode.ts
│   ├── ConflictDialog/                      # NEW (or reuse toast with Details)
│   │   └── (inline in EditModeProvider via toast)
│   ├── DocumentView/
│   │   └── DocumentView.tsx                 # MODIFY: rehype add data-source-line; expose scroll API
│   ├── EmptyState/
│   │   └── EmptyState.tsx                   # MODIFY: + "新建" 按钮
│   ├── Titlebar/
│   │   └── Titlebar.tsx                     # MODIFY: + ✏️ 切换按钮、+ ● dirty prefix on filename
│   ├── StatusBar/
│   │   └── StatusBar.tsx                    # MODIFY: + 右侧 行:列/字数/dirty 显示
│   └── Toc/
│       └── Toc.tsx                          # MODIFY: 编辑模式隐藏（接 useEditMode）
├── hooks/
│   ├── useShortcuts.ts                      # MODIFY: + Ctrl+E / Ctrl+N / Ctrl+S / Ctrl+Shift+S
│   ├── useDirtyGuard.ts                     # NEW: wraps Ctrl+W / close / Ctrl+R confirm
│   └── useFileWatcher.ts                    # MODIFY: 编辑+dirty 时改走冲突 UI
├── lib/
│   ├── settings.ts                          # MODIFY: + editor / splitRatio fields + migration
│   ├── settingsStore.ts                     # MODIFY: 适配新字段 (现有 partial-merge 已支持)
│   ├── tauri.ts                             # MODIFY: + saveDocument(path, text), + saveAsDocument
│   └── rehypeSourceLine.ts                  # NEW: rehype plugin 给块级元素加 data-source-line
└── App.tsx                                  # MODIFY: + EditModeProvider, + dirty guards
```

### Lazy-load CM6

```ts
// src/components/Editor/CodeMirrorEditor.tsx
const CodeMirror = lazy(() => import('@uiw/react-codemirror'));

// In split view:
{mode === 'edit' && (
  <Suspense fallback={<EditorSkeleton />}>
    <CodeMirror ... />
  </Suspense>
)}
```

CM6 + markdown lang + 主题 + 自定义 keymap 一起约 200 KB gzip 独立 chunk。

### Scroll sync 算法

1. `rehypeSourceLine` 在每个块级 hast 节点加 `data-source-line="N"`（N = mdast position.start.line）。
2. `useEditorScrollSync` 监听 CM6 的 `EditorView.updateListener`，每次 cursor line 变化（debounce 50ms）：
   - `const targetEl = preview.querySelector('[data-source-line="' + line + '"]')`
   - 若找到 → `targetEl.scrollIntoView({ block: 'start', behavior: 'instant' })`
   - 若没找到 → 找最近的 prev sibling with `data-source-line`，按 line offset 估算
3. 预览侧不反向同步（避免循环 + 预览滚动很常见用户只是看不想跳编辑器）

### Settings migration

```ts
// src/lib/settings.ts
function migrate(raw: unknown): Settings {
  const safe = (typeof raw === 'object' && raw !== null) ? raw as Partial<Settings> : {};
  return {
    version: 1,
    theme: safe.theme ?? 'system',
    pageZoom: safe.pageZoom ?? 100,
    showTocByDefault: safe.showTocByDefault ?? true,
    splitRatio: safe.splitRatio ?? 0.5,
    editor: {
      defaultMode: safe.editor?.defaultMode ?? 'read',
      autoSave: safe.editor?.autoSave ?? false,
      scrollSync: safe.editor?.scrollSync ?? true,
      lineNumbers: safe.editor?.lineNumbers ?? false,
      lineWrap: safe.editor?.lineWrap ?? true,
      tabSize: safe.editor?.tabSize ?? 2,
    },
  };
}
```

### Dirty guard hook

```ts
// src/hooks/useDirtyGuard.ts
export function useDirtyGuard(dirty: boolean, onSave: () => Promise<void>) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  
  // Wrapped close: confirm + maybe save
  const guardedClose = useCallback(async (onAfter: () => void) => {
    if (!dirty) { onAfter(); return; }
    const choice = await confirmDialog('有未保存的修改', ['放弃', '取消', '保存并继续']);
    if (choice === '取消') return;
    if (choice === '保存并继续') await onSave();
    onAfter();
  }, [dirty, onSave]);
  
  return { guardedClose };
}
```

---

## Decision (ADR-lite)

| # | Topic | 选项 | 选择 | 理由 |
|---|---|---|---|---|
| ED-1 | 编辑器内核 | Monaco / CM6 / textarea | **CodeMirror 6** | 比 Monaco 小 20x，markdown 高亮 + 多光标全有 |
| ED-2 | 走法 | A 轻编辑 / B WYSIWYG / C vault | **A** | 保留 v0.1 阅读定位；B/C 是产品转型不是 v1.0 |
| ED-3 | 布局 | 横向/纵向/自适应/tab | **自适应（宽 >900 横向，否则纵向）** | 兼顾大屏笔记本 |
| ED-4 | 默认模式 | 阅读/编辑 | **阅读** | 保 v0.1 心智，不破坏 reader 定位 |
| ED-5 | 切回阅读时 dirty | 提示/静默保存/丢弃 | **静默保存** | 体验顺滑；用户用 Ctrl+S 也能显式保存 |
| ED-6 | Auto-save | 开/关 | **关**（默认）| Ctrl+S 显式 + 切模式自动 已够；后台 auto-save 易冲突 watcher |
| ED-7 | Scroll sync 方向 | 单向编辑→预览/双向 | **单向**（编辑→预览） | 双向易陷入循环 |
| ED-8 | CM6 主题切换 | 热替换/remount | **remount via key={theme}** | CM6 extension 不支持热替换 |

---

## Out of Scope (v1.0)

* **WYSIWYG inline editing**（Tiptap / Milkdown / ProseMirror）——属于走法 B，v2.0+
* **Vault / [[wikilink]] / 反向链接 / 关系图**——属于走法 C，可能永不做
* **多 tab 同时编辑多文件**——v0.1 故意拒绝过，v1.0 保持
* **协同编辑（Y.js / Liveblocks）**——离线工具，不做
* **Web Clipper / 浏览器扩展抓网页存 md**——无关定位
* **Markdown linter / formatter（如 prettier-markdown）**——v2.0 可选
* **Math editor（LaTeX 实时预览面板）**——纯渲染够了，不做编辑助手
* **Mermaid 编辑助手**（行内画图工具）——纯文本编辑够了
* **后台 auto-save**——v1.0 仅显式 + 切模式
* **GUI 设置面板**——仍是 v0.2 范围；v1.0 新字段进 settings.json 直接编辑
* **GitHub Sync / cloud sync / Git 集成**——v3.0+
* **演讲模式**——独立特性，v2.0+
* **macOS / Linux 构建**——仍 Windows-only for v1.0

---

## Implementation Plan (PR slices)

### PR-A：编辑骨架（~5-7 天）

* CM6 lazy 集成 + markdown lang + base 主题（单色，PR-B 接双主题）
* SplitView 组件（默认 50/50，无拖拽 — PR-B 加）+ 自适应横/纵切换
* EditModeProvider + `Ctrl+E` 切换 + ✏️ titlebar 按钮
* DocumentView 接 `editText` prop（编辑模式下 doc.text 来自 buffer，不是文件）
* 实时预览：CM6 onChange → 500ms debounce → setState 给 DocumentView
* Ctrl+S 保存 + dirty 跟踪 + ● titlebar prefix
* Ctrl+W / Ctrl+Q / 关窗 dirty 守卫（confirm dialog）
* 切回阅读静默 auto-save
* 编辑+dirty 时 watcher 冲突 toast（保留/重载）
* Status bar 右侧扩展：行:列/字数/dirty
* TOC 编辑模式隐藏

**AC**：R-EDIT-1 / R-EDIT-3 / R-EDIT-5 / R-EDIT-8 / R-EDIT-9.7 / R-EDIT-12（migration） 全勾。
**不包括**：滚动同步、新建/另存、markdown 工具快捷键、双主题、拖拽分隔条。

### PR-B：体验加料（~3-4 天）

* `rehypeSourceLine` 插件（data-source-line 属性）
* `useEditorScrollSync` 编辑光标 → 预览滚动
* `Ctrl+N` 新建未命名 buffer
* `Ctrl+Shift+S` 另存为 + 未命名 buffer 的 Ctrl+S = 弹 save dialog
* Markdown 工具快捷键（Ctrl+B / I / K / Shift+K）+ 智能列表延续
* CM6 双主题（github-light / github-dark）+ 主题切换 remount with selection 保留
* 拖拽 split 分隔条 + 比例持久化
* EmptyState "新建" 按钮
* Settings 新字段全部生效（lineNumbers / lineWrap / tabSize / scrollSync 开关）
* Recent.json: 新建并保存后加入 recent

**AC**：R-EDIT-2.2/2.3 / R-EDIT-4 / R-EDIT-6 / R-EDIT-7 / R-EDIT-10 / R-EDIT-11 / R-EDIT-12 余下项全勾。

### Release PR (PR-C，~半天)

* Bump version: package.json + Cargo.toml + tauri.conf.json → `1.0.0`
* README 加 "编辑模式" 章节 + 新快捷键
* `pnpm tauri build`
* tag `v1.0.0` + GitHub Release（NSIS + MSI），release notes 含从 v0.1 升级路径说明

---

## Technical Notes

* **CM6 React 集成**：`@uiw/react-codemirror` 提供 `<CodeMirror value onChange extensions theme>` props，React-friendly。它内部 wrap 了一个 EditorView 实例。重渲染时不会重建 EditorView（diff value prop），所以性能 OK。
* **`@codemirror/lang-markdown`**：自带 GFM 子集支持（task list、tables）+ basic highlight。
* **CM6 多光标 / 搜索 / 折叠**：base 包默认未启用，需要加 `EditorView.extensions: [basicSetup, ...]` 或单独 import `@codemirror/commands` + `@codemirror/search`。
* **滚动同步性能**：debounce cursor change 50ms，避免每个 keystroke 都触发 querySelector。
* **未命名 buffer 路径处理**：`doc.path = null` 时各种"按 path 索引"的 store（recent、scrollPositions、file watcher）都要跳过 / no-op。
* **保存路径与 recent**：通过现有 `loadDocument` 走，自动加 recent + 启 watcher。
* **冲突检测**：watcher 在编辑模式下不能 silently call loadDocument。需要在 useFileWatcher 里读 `isDirty` 状态，dirty 时改走 toast UI。这要在 useFileWatcher 接 EditModeProvider 上下文。
* **dirty guard 的 confirm dialog**：v1.0 不引入第三方 dialog 库，用 `window.confirm()` 或 Tauri 的 native dialog (`@tauri-apps/plugin-dialog` 的 `confirm` / `ask` 已经在 capabilities)。**实际选**：用 `confirm` from `@tauri-apps/plugin-dialog`，三按钮要自定义（plugin 只支持 yes/no），所以做一个自己的 modal `ConfirmDialog`。

---

## Open Questions

无（用户已在设计访谈中全权委托：所有问题按推荐答案进行）。
