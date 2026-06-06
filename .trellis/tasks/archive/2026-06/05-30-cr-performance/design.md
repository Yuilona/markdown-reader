# CR-Performance — Technical Design

> 父任务 `05-30-code-review-remediation`。配套 `prd.md`（R1–R8）+ `implement.md`。
> 证据见父任务 `research/findings-full-2026-05-30.md`。
> 优先级：按「对响应性/内存的实际影响」从高到低；可分期落地（见 implement.md PR 分组）。

## 关键设计决策（评审门请确认）

- **D-PERF-1 本轮范围**：高影响子集（R1 Shiki 缓存 + R3 大文件守卫 + R4 mermaid LRU）先做一轮，还是 R1–R8 全做？
- **D-PERF-2 logger（R2）实现**：(A) 新增 Rust `append_log_line` 命令（O(1)/行，正解）/ (B) 仅 JS 侧加写队列 + 内存计数（去掉双读与交错，仍 O(n)/行，无 Rust 改动）/ (C) 本轮跳过（实测日志量极低）。

---

## R1（#1，高）Shiki 同步高亮：按块缓存 + 大文档降级
**问题**：`rehypeShikiFromHighlighter` 在 react-markdown 的同步 `runSync` 里对全文每个代码块用 Oniguruma WASM 重新分词；唯一 memo 是整段 `body`，改一个字就全量重分词。代码密集大文档每次（编辑模式 500ms 防抖后）卡几百 ms。

**设计**：
1. **按块缓存**：给 `rehypeShikiFromHighlighter` 传一个模块级 `cache: Map`（@shikijs/rehype 支持 `cache` 选项，按 `${lang}:${meta}:${code}` 记忆化——审计已确认当前未传）。未变的代码块不再重分词；编辑时只有改动的块重算。
   - 内存上界：给该 Map 加 LRU 上限（如 512 条，仿 R4），避免跨文档无限增长。
   - 实现期校验 `@shikijs/rehype` 的确切选项名/类型；若不支持则退化为自写「`lang::code` → hast 片段」记忆化包装。
2. **大文档降级**（与 R3 合用）：超阈值时**跳过 Shiki**，代码渲染为无高亮 `<pre>`，避免多秒级主线程占用。

**文件**：`src/lib/markdownPlugins.ts`（传 cache + 可切换的 rehype 链）、`DocumentView.tsx`（按阈值选择链）。

## R3（#4，中）大文件守卫
**问题**：打开 ~10MB md，首屏一次性跑完整同步管线 + 全量建 DOM，冻结数百 ms~数秒，无任何阈值。

**设计**：常量 `LARGE_DOC_BYTES`（默认约 1.5–2MB，建议放 `settings.json`）。`body.length` 超阈值时：
- 用**精简 rehype 链**（省略 Shiki）渲染（代码走 plain `<pre>`）——与 R1 的降级开关共用。
- （可选）顶部提示「大文件，已关闭语法高亮以保持响应」。
- MVP 不做完整虚拟化/分块渲染（见 prd Out of Scope）；只把最重的 Shiki 移出大文档首屏。

**文件**：`DocumentView.tsx`（阈值判断 + 链选择）；阈值可选进 `settings.ts`。

## R4（#14，低）mermaidCache 加 LRU
**问题**：`mermaidCache.ts` 的 Map 只在切主题清旧主题片，浏览文档从不淘汰 → 无上限增长（每图几十~上百 KB SVG）。

**设计**：`putCached` 超上限（如 **64** 条）按 LRU 淘汰；`getCached` 命中时 `delete`+`set` 移到尾部（Map 保持插入序）。`clearCacheForTheme` 行为不变。小而独立。

**文件**：`src/lib/mermaidCache.ts`。

## R6（#15，低）滚动同步缓存有序表
**问题**：编辑模式每次光标**行**变化（50ms 防抖）`querySelectorAll('[data-source-line]')` + O(n) 线性扫描 + offsetParent 走链 reflow；节点数随 li/tr/p/h* 增长。

**设计**：按文档版本（DocumentView 已有的 `tocVersionKey`/doc.path+text）缓存排序后的 `(line, element)[]`；光标移动时**二分**定位，免去每次 querySelectorAll + 线扫。DOM 变化（换文档/重渲染）时失效重建。

**文件**：`src/components/Editor/useEditorScrollSync.ts`（+ 复用 DocumentView 的 versionKey）。
> 注：cr-correctness 只改了 `DocumentView.handlePreviewClick`，**未动** `useEditorScrollSync.ts` 内部，无冲突。

## R5（#16，低）搜索匹配数上限
**问题**：`findMatches` 无上限收集、`highlightMatches` 每命中 2×splitText+replaceChild；大文档 + 宽查询（单个常用 CJK 字）→ 上万 `<mark>`，多秒冻结。

**设计**：`findMatches` 收集到上限 `MAX_MATCHES`（如 **2000**）即停；`SearchBar` 计数显示「N+ / 2000+」。可选：只物化视口附近、其余惰性——MVP 先做硬上限。

**文件**：`src/components/Search/domSearch.ts`、`useSearch.ts`、`SearchBar.tsx`（计数展示）。

## R8（#17，低）滚动记忆内存化
**问题**：连续滚动每 250ms 防抖保存都整读+过滤+(条件)排序+原子写整文件。

**设计**：解析后的 positions 数组常驻模块内存（首次读一次），就地改；写盘改用更粗防抖（1–2s）或仅切档/卸载时。去掉每次的 parse + 全量读写。

**文件**：`src/lib/scrollPositions.ts`、`src/hooks/useScrollMemory.ts`。

## R2（#3，中）logger —— 见 D-PERF-2
**问题**：每写一行先 `rollIfNeeded` 整读测长、再整读拼接、整写回（2 读 1 写，O(n)/行，~O(n²)/会话）；fire-and-forget 无队列 → 并发突发交错丢行。

**设计（取决于 D-PERF-2）**：
- **A**：新增 Rust `#[tauri::command] append_log_line` 用 `OpenOptions::append`（O(1)，无读）；logger.ts 改 invoke；模块内存维护字节计数供轮转判断；JS 侧单 promise 链串行化（仿 `settingsStore` writeQueue）。
- **B**：保留 JS 读改写，但去掉 `rollIfNeeded` 的二次整读（内存计数）+ 加写队列串行化（消除交错丢行）。仍 O(n)/行但去掉双读与并发风险，零 Rust 改动。
- **C**：本轮跳过（实测仅 catch 路径触发、文件极小）。

**文件**（A）：`src-tauri/src/lib.rs` + `src/lib/logger.ts`；（B）：仅 `src/lib/logger.ts`。

## R7（#13，低）正则搜索 ReDoS
**问题**：正则模式 `new RegExp(用户输入)` 无复杂度/超时，`(a+)+$` 类卡死单线程 UI。**自输入**（非恶意文档），故低危。

**设计（取舍）**：JS 正则回溯无法在单次 exec 中断；真正防护需 Web Worker + 超时或线性引擎。MVP 取轻量启发式：限制模式长度 + 跨文本节点间插入时间预算（超时则中止本次搜索、提示「搜索过于复杂」），不追求完全防护。**优先级最低，可随 D-PERF-1 决定去留。**

**文件**：`src/components/Search/domSearch.ts`、`useSearch.ts`。

---

## 验证矩阵
| 簇 | 命令 |
|---|---|
| 前端（R1/R3/R4/R5/R6/R7/R8） | `pnpm exec tsc --noEmit` + `pnpm test` + `pnpm build` |
| R2-A（含 Rust） | 额外 `cd src-tauri && cargo check`（+ 视情 `cargo build`） |
| 性能验证 | 用一份大/代码密集文档 + 含多 Mermaid 文档目检：打开/编辑不再长时间冻结；缓存命中可观测 |

## 风险
- R1：依赖 `@shikijs/rehype` 的 `cache` 选项语义——实现期先小验证；缓存键需含主题？（双主题以 CSS 变量输出，单次高亮含两套色，故 key 无需含主题——确认。）
- R1/R3 降级开关要保证：切到精简链不破坏 source-line 打戳（编辑器联动）与 Mermaid 预处理顺序。
- R2-A：新增 Rust 命令需 `cargo check`/build 验证；写权限走原生命令、无需新 capability。
- R6：versionKey 失效时机要覆盖 watcher 重载（text 变、path 不变）。
