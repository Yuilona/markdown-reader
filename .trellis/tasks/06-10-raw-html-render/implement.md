# Implement — raw-html-render

> 顺序执行;每步验证。依据 `design.md`。`task.py start` 后动手。

## 前置

- [ ] `python ./.trellis/scripts/task.py start 06-10-raw-html-render`
- [ ] 基线绿:`pnpm exec tsc --noEmit` && `pnpm test`

## 步骤

- [ ] **依赖**:`pnpm add rehype-raw@^7 rehype-sanitize@^6`(核对 lockfile 仅增这两个 + 传递依赖 hast-util-raw / hast-util-sanitize)
- [ ] **新建 `src/lib/sanitizeSchema.ts`**:spread `defaultSchema` + img(alt/title/width/height/loading)+ 表格(td/th/col/colgroup)+ 通配符(className + 小写表格属性)+ `pre.dataMermaidSource`;**不加** style / on* / 其它 data*
- [ ] **改 `DocumentView.tsx`**:import `rehypeRaw`、`rehypeSanitize`、`sanitizeSchema`;重写 `rehypePluginsWithMermaid` 与 `rehypePluginsNoHighlightWithMermaid` 两个常量为新顺序(见 design)
- [ ] **新建 `src/lib/markdownPipeline.test.ts`**:用 unified 跑全链 fixtures(remarkParse+gfm+remark-rehype{allowDangerousHtml}+新 rehype 链)——
  - (a) HTML `<img src alt width>` 元素+属性保留(alt 不被剥,回归守卫)
  - (b) 手写 `<table>` + `align`/`colspan` 保留
  - (c) **XSS 必杀**(逐条断言危险节点/属性已消失):`<script>` / `<img onerror>` / `<iframe>` / `<style>{url()信标}` / inline `style=` / `<meta http-equiv=refresh>` / `<base href>` / `<a href="javascript:">`
  - (d) GFM 管道表 + 手写 `<img>` 同文档都渲染
  - (e) ```mermaid 围栏 + 相邻 `<div>`:`<pre>` 仍带 `data-mermaid-source` 且 `<div>` 渲染(证明 mermaidPretag-在-rehypeRaw-前 + dataMermaidSource 白名单)
- **验证**:`pnpm exec tsc --noEmit` && `pnpm test`
- **回滚**:`git checkout -- src/components/DocumentView/DocumentView.tsx package.json pnpm-lock.yaml` + 删 `src/lib/sanitizeSchema.ts`、`src/lib/markdownPipeline.test.ts`

## 收尾(对应 AC)

- [ ] `pnpm tauri build` 成功(Windows);CSP/asset 本地图片仍正常
- [ ] 已构建产物冒烟:HTML img/表格 渲染;mermaid / Shiki / KaTeX / 源行同步 / 本地图片 无回归;大文档降级路径也渲染 HTML
- [ ] 提交;按需 `task.py archive`

## 既有测试

- `rehypeSourceLine.test.ts`:独立跑插件、不走全链,应仍绿(复跑确认)。
- `domSearch.test.ts`:直接 `createElement` 建 DOM、不走 rehype 链,实际不受影响(调查 SCOPE 略夸大),复跑确认无意外。
