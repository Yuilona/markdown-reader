# Raw HTML rendering (images + tables) via rehype-raw + sanitize

> 来源:用户反馈"阅读器不支持 HTML 格式图片与表格的渲染"。2026-06-09 多代理调查
> (workflow `wf_ad1c1b0b-0c3`:链路影响 / 安全面对抗式核验 / 库版本 / 范围测试 + 汇总,
> confidence high)已确认根因与安全方案;本任务据此实现。

## Goal

让阅读器渲染文档中**手写的 HTML**(主要是 `<img>` 与 `<table>`,及 GitHub-safe 常见格式
元素),且**不引入 XSS / 隐私泄露**,不回归现有 Shiki / KaTeX / mermaid / 源行同步 /
本地图片。

## 背景 / 根因

react-markdown v10 内部以 `allowDangerousHtml` 调用 remark-rehype,原始 HTML 留成 `raw`
节点并被转义;项目**未装 `rehype-raw`** → 手写 `<img>` / `<table>` 被当文本转义掉。
GFM 管道表格(`| a | b |`)经 remark-gfm **本就正常**,不在修复范围。

## Requirements

- **R1** 渲染手写 HTML 图片与表格(及 GitHub-safe 常见格式元素)。
- **R2 安全(严格姿态,D1)**:清洗必须剥离 CSP 挡不住的残留——`<style>` / `style=`(CSS 信标去匿名化)、`<iframe>/<object>/<embed>`、`<meta http-equiv=refresh>`、`<base>`、所有 `on*`、`javascript:`/`data:` URL,以及 `<script>/<svg>/<form>` 等。
- **R3 零回归**:Shiki 高亮、KaTeX、mermaid(`data-mermaid-source`)、源行两遍打点(`data-source-line`)、本地图片(`http://asset.localhost`)、大文档降级链 全部照常。
- **R4** HTML `<img>` / `<a>` 仍走现有 `components.img`(resolveImageSrc)/ `components.a`(linkRouter)。

## 已确认决策(2026-06-09,与用户确认)

- **D1 姿态**:严格白名单 + **完全剥离 `style` / `style=`**(基于 rehype-sanitize `defaultSchema` 扩展)。
- **D2 data-mermaid-source**:在 schema 给 `<pre>` 白名单放行 `dataMermaidSource`(mermaid 检测必须在 rehypeRaw 之前 → 也在 sanitize 之前)。
- **D3** 大文档降级链同样加 raw + sanitize(否则大文件里 HTML 仍转义)。
- **D4** 远程 `<img>` 追踪信标:已存在的固有隐私残留,本次不扩大、不处理(可作后续"禁用远程图片"开关)。

## Acceptance Criteria

- [ ] 手写 `<img src alt width>` 与 `<table>`(含 `align`/`colspan`/`rowspan`)能渲染、属性保留。
- [ ] XSS 必杀清单全部被清除(见 design):`<script>` / `onerror=` / `<iframe>` / **`<style>` 信标** / inline `style=` / `<meta refresh>` / `<base>` / `javascript:` href。
- [ ] mermaid 图、Shiki 高亮、KaTeX、源行同步、本地图片 全部无回归(含大文档降级路径)。
- [ ] `pnpm exec tsc --noEmit` + `pnpm test`(新增 markdownPipeline 测试)通过;`pnpm tauri build` 成功。
- [ ] 已构建产物冒烟:含 HTML img/表格 + mermaid + 代码块 + KaTeX 的文档正常。

## Out of Scope

- 远程图片追踪防护开关(D4,后续)。
- 放行 SVG / MathML 原始 HTML(mermaid/katex 经可信插件产出,非作者原始 HTML)。

## Notes

- 完整调查见 workflow `wf_ad1c1b0b-0c3`(根因 / 安全 / 库 / 范围 / 汇总);`design.md` 为其落地蒸馏。
