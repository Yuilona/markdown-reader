# CR-Performance — Execution Plan

> 配套 `prd.md` + `design.md`。分期 PR；每个 PR 结束跑对应验证、独立可回滚。
> 落地范围与 logger 实现取决于评审门的 D-PERF-1 / D-PERF-2。

## 待你确认（评审门）
- **D-PERF-1 范围**：先做高影响子集（PR-1 = R1+R3+R4），还是 R1–R8 全做？
- **D-PERF-2 logger（R2）**：A 新增 Rust `append_log_line` / B 仅 JS 写队列+内存计数 / C 本轮跳过。
- **R7（ReDoS）** 是否纳入本轮（自输入、低危，可推迟）。

---

## PR-1 ── 高影响：Shiki 缓存 + 大文件守卫 + mermaid LRU（R1 + R3 + R4）
- [ ] R1：给 `markdownPlugins.ts` 的 `rehypeShikiFromHighlighter` 传模块级 `cache: Map`（先小验证 @shikijs/rehype 的 `cache` 选项；不支持则自写记忆化包装）；给该 Map 加 LRU 上限（~512）
- [ ] R3+R1 降级：`DocumentView.tsx` 加 `LARGE_DOC_BYTES` 阈值，超阈值用**省略 Shiki**的精简 rehype 链（代码 plain `<pre>`）；确认 source-line 打戳与 mermaid 预处理顺序不被破坏；（可选）顶部提示
- [ ] R4：`mermaidCache.ts` 加 LRU（上限 ~64；get 命中 delete+set 移尾，put 超限淘汰最旧）
- **验证**：`pnpm exec tsc --noEmit` + `pnpm test` + `pnpm build`；用代码密集大文档 + 多图文档目检不再长冻结、缓存命中可观测
- **回滚点**：`git checkout --` 上述文件

## PR-2 ── 中影响：滚动同步 / 搜索上限 / 滚动记忆（R6 + R5 + R8）
- [ ] R6：`useEditorScrollSync.ts` 按 versionKey 缓存排序的 `(line,element)[]`，二分替代每次 querySelectorAll+线扫；DOM 变化（含 watcher 重载 text 变）失效重建
- [ ] R5：`domSearch.ts` `findMatches` 加 `MAX_MATCHES`（~2000）上限；`SearchBar` 计数显示「N+」
- [ ] R8：`scrollPositions.ts` 内存化数组（首次读一次、就地改），`useScrollMemory.ts` 写盘改粗防抖（1–2s）/切档/卸载
- **验证**：`pnpm exec tsc --noEmit` + `pnpm test` + `pnpm build`

## PR-3 ── logger（R2，按 D-PERF-2）
- [ ] A：Rust `#[tauri::command] append_log_line`（`OpenOptions::append`）+ logger.ts 改 invoke + 内存字节计数 + JS 写队列串行化 → `cargo check`/`build`
- [ ] B：仅 logger.ts —— 去掉 `rollIfNeeded` 二次整读（内存计数）+ 写队列串行化
- [ ] C：跳过
- **验证**：前端三连；A 另加 `cargo check`(+build)

## PR-4（可选）── R7 ReDoS 轻量守卫
- [ ] `domSearch.ts`/`useSearch.ts`：限制模式长度 + 跨节点时间预算，超时中止并提示；不追求完全防护
- **验证**：前端三连

---

## 收尾（Phase 3）
- [ ] 已落地范围全绿后勾选 `prd.md` 对应验收项（未做的标注「本轮未做/推迟」）
- [ ] 提交（建议按 PR 分 commit；末尾带 Co-Authored-By trailer）
- [ ] `task.py finish` + `task.py archive 05-30-cr-performance`
- [ ] 父任务 `05-30-code-review-remediation` 4/4 → 视情 finish/归档父任务
- [ ] 不回归 v1.2.0 既有行为（打开/保存/watcher/编辑联动/搜索/主题/打印）

## 验证命令速查
```bash
pnpm exec tsc --noEmit && pnpm test && pnpm build
cd src-tauri && cargo check   # 仅当 R2 选 A
```
