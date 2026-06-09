# Design — raw-html-render

> 蒸馏自 2026-06-09 多代理调查(workflow `wf_ad1c1b0b-0c3`,confidence high)。
> 勘查依据:`markdownPlugins.ts` / `DocumentView.tsx`(rehypePluginsWithMermaid &
> NoHighlight)/ `rehypeSourceLine.ts` / `rehypeMermaidPretag.ts` / `tauri.conf.json`(CSP)。

## 方案

新增依赖 `rehype-raw@^7` + `rehype-sanitize@^6`,新建 `src/lib/sanitizeSchema.ts`,
**仅改 `DocumentView.tsx` 的两个 rehype 链常量**。`markdownPlugins.ts` 的
`rehypeBase` / `rehypePlugins` / `rehypePluginsNoHighlight` 不动。

## 链路顺序(关键 —— 改错会悄悄坏功能)

```
现:
  rehypePluginsWithMermaid        = [sourceLine, mermaidPretag, ...rehypePlugins, sourceLineApply]
  rehypePluginsNoHighlightWith..  = [sourceLine, mermaidPretag, ...rehypePluginsNoHighlight, sourceLineApply]
改:
  withMermaid   = [mermaidPretag, rehypeRaw, [rehypeSanitize, schema], sourceLine, ...rehypePlugins, sourceLineApply]
  noHighlight   = [mermaidPretag, rehypeRaw, [rehypeSanitize, schema], sourceLine, ...rehypePluginsNoHighlight, sourceLineApply]
```

每条顺序都有原因:
- **mermaidPretag 最前**:它写 `data-mermaid-source` 供 Mermaid 组件路由;须在 rehypeRaw 前(读 mermaid 围栏的原始文本)。
- **rehypeRaw**:把 `raw` HTML 字符串解析成真 hast 节点(react-markdown v10 内部已 `allowDangerousHtml`,**无需自己传**)。
- **sanitize 紧跟 rehypeRaw**:在任何下游插件看到节点前清洗;且必须在 slug/katex/shiki/sourceLine **之前**——否则会剥掉它们后加的 heading `id` / KaTeX 类+MathML / Shiki 的 `language-*` 类+内联 `style` / `data-source-line`。
- **sourceLine 移到 sanitize 之后**:避免 `data-source-line`(`data-*`)被 sanitize 剥掉 → 编辑器滚动同步不坏。
- **slug/katex/shiki 在 sanitize 之后**:它们的输出不被剥。
- **sourceLineApply 最后**:照旧重打 Shiki 替换过的代码块。

## sanitize schema(`src/lib/sanitizeSchema.ts`)

spread `defaultSchema`(GitHub-safe),只扩展必需项,**绝不 mutate**(逐 tag 数组也 spread):
- **img**:加 `alt` / `title` / `width` / `height` / `loading`(⚠ defaultSchema 默认**不放行** alt/title/width/height!不加则图片 alt+尺寸全被剥)。
- **表格**:`td`/`th` 加 `colspan`/`rowspan`/`align`/`valign`(+`th` `scope`);`col`/`colgroup` 加 `span`。(defaultSchema 通配符已含 camelCase `align`/`colSpan`/`rowSpan`。)
- **`*` 通配符**:加 `className` + 小写 `colspan`/`rowspan`/`align`/`valign`。
- ⚠ **`pre` 加 `dataMermaidSource`**(D2,保住 mermaid 检测标记)。
- 保留 `defaultSchema.protocols`(href/src 仅 http/https/mailto + 相对)→ 二次拦 `javascript:`/`data:`。Tauri `http://asset.localhost` 是 http,可过。
- **绝不**加:`style`(元素与属性)、任何 `on*`、`data*`(除 `pre` 的 `dataMermaidSource`)、`script`/`iframe`/`object`/`embed`/`form`/`svg`/`math`/`meta`/`base`/`link`。

## 安全核验(对抗式,已验证)

- **`<script>` + 字符串 `on*` 处理器**:react-dom 18.3.1 不执行注入的 script + 丢弃字符串事件属性,且 CSP `script-src` 无 `unsafe-inline` → **双重挡死**(非真威胁)。
- **HTML `<img>`/`<a>`** 仍走 `components.img`/`components.a` + react-markdown `defaultUrlTransform`(blank `javascript:`/`data:`)。
- **CSP 挡不住、必须 sanitize 剥的真残留**:`<style>` / `style=`(`style-src` 允许 `unsafe-inline` → `background:url(https://evil)` 信标**去匿名化**,最关键)、`<iframe>/<object>/<embed>`、`<meta refresh>`、`<base href>`。
- **固有残留(不扩大)**:远程 `<img>` 追踪信标(markdown 时代已存在)。

## 风险

- rehype-raw 重建位置信息:纯 raw HTML 块的源行映射到块**起始行**(编辑器同步块粒度,非像素级)——可接受。
- 忘记 `dataMermaidSource` 白名单 → 所有 mermaid 图**静默失效**(测试 (e) 覆盖)。
- 包体:`hast-util-raw` ~60kb gz,桌面可接受。
- 未来若重加 inline `style` 需经 `url()` 过滤,否则重开信标路径。
