# CR-Performance: Shiki 缓存 / logger / 大文件守卫 / 各类缓存

> 父任务：`05-30-code-review-remediation`。来源发现：#1 #3 #4 #13 #14 #15 #16 #17。
> 证据见父任务 `research/findings-full-2026-05-30.md` 对应 `### [N]` 小节。
> 本子任务**复杂度中~大**：含 Rust 新命令(#3) 与 Shiki 缓存(#1)，`task.py start` 前补 `design.md` + `implement.md`。

## Goal

消除主线程长任务与无上限内存增长，让大/代码密集文档与连续操作下 UI 保持响应。优先级
按「影响响应性/内存的程度」排序，**不追求一次全做完**——可按 R 拆 PR。

## What I already know（已核实）

- **#1（High）Shiki 同步高亮阻塞主线程**：`markdownPlugins.ts:95-114` 的
  `rehypeShikiFromHighlighter` 在 react-markdown 的同步 `runSync` 管线里执行（`DocumentView.tsx:437`
  `markdownEl` useMemo），用 Oniguruma WASM 在主线程对**全文每个代码块**重新分词。唯一 memo 是整段
  `body`，改一个字就全量重分词。插件支持 per-block `cache` 选项但**未传**。编辑模式下每次 500ms
  防抖后触发一次，大文档=每次停顿都卡几百 ms。
- **#3（Medium）logger 整文件读改写**：`logger.ts:195-212` 每写一行先 `rollIfNeeded` 整读一遍
  测长度(`:175`)、再整读一遍(`:207`)拼接、整写回(`:208`)——每行 2 读 1 写，O(fileSize)，会话内
  ~O(n²)，5MB 上限下单次近上限写≈搬 15MB。且 fire-and-forget 无队列(`:248/256/264`)，并发突发会
  交错丢行。**正常用量低**（仅 catch/错误路径），故 Medium；但恶意 .md 狂触错误路径可放大。
- **#4（Medium）无大文件守卫**：`tauri.ts` `loadDocument` 不限大小；`DocumentView` 首屏即用全文
  （`useDebouncedValue` 初值同步返回），跑完整同步管线 + 全量建 DOM（无虚拟化），10MB 文档首屏可卡
  数百 ms~数秒。与 #1 叠加。
- **#14（Low）mermaidCache 无淘汰**：`mermaidCache.ts` 的 Map 只在切主题清旧主题片，浏览文档从不淘汰，
  每个看过的图（几十~上百 KB SVG）永久驻留；sibling `scrollPositions.ts` 已有 MAX_ENTRIES=100 范式可循。
- **#15（Low）滚动同步每次行变化全量 DOM 扫描**：`useEditorScrollSync.ts:142-154` 每次光标**行**变化
  （非每键）`querySelectorAll('[data-source-line]')`+线性扫描 + offsetParent 走链 reflow；节点数随
  li/tr/p/h* 增长。可按文档版本缓存 (line,element) 有序表 + 二分。
- **#16（Low）搜索高亮无匹配上限**：`domSearch.ts` `findMatches` 无上限收集、`highlightMatches` 每命中
  2×splitText+replaceChild；大文档 + 宽查询（如单个常用 CJK 字）→ 上万 `<mark>`，多秒冻结。
- **#13（Low）正则搜索 ReDoS**：`domSearch.ts:232-255` 用 `new RegExp` 编译搜索框原始输入、无复杂度/
  超时，`(a+)+$` 类模式卡死单线程 UI。**自输入**（非恶意文档），故 Low。
- **#17（Low）滚动记忆全量读改写**：`scrollPositions.ts` 每 250ms 防抖保存都整读+过滤+(条件)排序+原子写整文件；
  上限 100 条，绝对开销小（非 O(n²)），只是单个 Y 整数更新却重写整文件，churn 偏多。

## Requirements（建议按优先级分 PR）

### R1（#1，最高）Shiki 按块内容寻址缓存 + 大文档降级
- 给代码块高亮加 `lang::source` 内容寻址缓存（仿 `mermaidCache.ts`），未变的块不重分词；
  或给 Shiki rehype 插件传它原生支持的 `cache` 选项。
- 大文档阈值降级：超阈值（如 >N 代码块或 >1–2MB body）跳过/延迟 Shiki，先出无高亮 `<pre>`，
  空闲回调里再升级；至少把重管线移出同步首屏路径。（与 R3 协同。）

### R2（#3）logger 改 Rust append + 内存计数 + 写队列
- 加 Rust 命令 `append_log_line`（`OpenOptions` append），前端 `appendLine` 改调它——O(1)/行、不整读。
- 模块内维护 running byte count（init 时 stat/读一次播种），`rollIfNeeded` 不再每次整读。
- 用单 promise 链串行化写入（仿 `settingsStore.ts:57` writeQueue），杜绝并发交错丢行。

### R3（#4）大文件守卫
- 加可配置阈值（如 body >2MB）：超阈值 (a) 跳过/延迟 Shiki，(b) 给「大文件，渲染可能慢」提示，
  (c) 至少让重管线离开同步首屏（先快速出原文，空闲再升级）。与 R1 共用降级开关。

### R4（#14）mermaidCache 加 LRU 上限
- putCached 超上限（如 50–100 条或字节预算）按 LRU 淘汰；getCached 命中时 delete+set 移到尾部。

### R5（#16）搜索匹配数上限
- `findMatches` 收集到 N（如 2000–5000）即停，SearchBar 显示「N+」；可只高亮视口附近、其余按导航惰性物化。

### R6（#15）滚动同步缓存有序表
- 按 DocumentView 已有的 versionKey 缓存排序后的 (line,element) 列表，二分代替每次 querySelectorAll+线性扫描。

### R7（#13）正则搜索预算/超时
- 正则模式下加步数/时间预算（或长度/嵌套量词限制，或 worker+超时），坏模式降级为「0 结果」而非冻结。

### R8（#17）滚动记忆内存化 + 粗化防抖
- 解析后的 positions 数组常驻内存、就地改，写盘改用更粗防抖（1–2s）或仅在切档/卸载时，去掉每次整读+排序+整写。

## Acceptance Criteria

- [ ] R1：改一处代码后，未改动的代码块不重新分词（缓存命中可观测）；大文档（如 >2MB / 多代码块）首屏不再产生数秒级主线程冻结
- [ ] R2：连续写日志不再随文件增大而变慢；并发错误突发不丢行；`cargo check` 通过
- [ ] R3：打开超阈值大文件时 UI 不长时间无响应（先出内容/有提示）
- [ ] R4：长时间浏览大量含图文档，mermaid 缓存条目数有界
- [ ] R5：超大文档上宽查询不再生成无上限 `<mark>`、不长时间冻结；计数显示「N+」
- [ ] R6：编辑模式下行间移动的同步开销与文档块数解耦（不再每次全量扫描）
- [ ] R7：恶意/坏正则不再冻结窗口
- [ ] R8：连续滚动时不再每 250ms 整文件读改写
- [ ] 全程 `pnpm exec tsc --noEmit` + `pnpm test` 通过；动 Rust 后 `cargo check` 通过；无功能回归

## Out of Scope

- 文章区完整虚拟化/窗口化渲染（#4 只做阈值守卫 + 延迟高亮）
- 把 Shiki 整体搬进 Web Worker（除非 R1 降级仍不够，再单议）

## Technical Notes

- #1/#3 是本子任务的主要工作量与风险点——`start` 前用 `design.md` 定缓存键/失效策略、Rust 命令签名、
  降级阈值与开关；`implement.md` 给分 PR 顺序（建议 R1→R3 一组，R2 一组，R4–R8 收尾）。
- #15 与 `cr-correctness` #7（同文件 `useEditorScrollSync.ts`）会改同一文件，注意协调改动顺序/避免冲突。
- 阈值/开关尽量走 `settings.json`（与现有 `editor.*` 一致），避免硬编码。
