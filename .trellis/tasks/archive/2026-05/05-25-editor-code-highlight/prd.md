# Editor fenced-code syntax highlighting

## Goal
编辑模式下，CodeMirror 编辑器里的围栏代码块（```js / ```python …）目前内容被统一打成 `tags.monospace`（单色），因为 `markdown()` 没配 `codeLanguages`。让编辑器对常用语言做真正的多色语法高亮，亮/暗都可读。

## Decision (确认：用户「都行」采纳推荐)
- 语言范围：**精选常用集**（非全量 language-data）：javascript/jsx/typescript/tsx、python、json、css、html、rust、go、sql、yaml、markdown、shell(bash)。每种用动态 import 的 `LanguageDescription`（懒加载，不进编辑器主 chunk）。
- 代码 token 配色：**亮 = `defaultHighlightStyle`，暗 = `oneDarkHighlightStyle`**（`@codemirror/theme-one-dark`），均以 `fallback:true` 作为兜底；自写的 `markdownHighlight`（Claude markdown 令牌）保持更高优先级覆盖 markdown 标签。先把高亮做出来，Claude 化代码 token 以后再说（Out of Scope）。

## Requirements
- `markdown({ codeLanguages })`：嵌入语言被解析 → 产生 keyword/string/number… token。
- 关掉 basicSetup 自带的 `syntaxHighlighting`（避免亮色 defaultHighlightStyle 在暗色下硬套），改由 themeExtension 按 effective 显式提供亮/暗代码高亮。
- markdown 令牌仍走 `markdownHighlight`（优先级高）。

## Acceptance Criteria
- [ ] 编辑器中 ```js/py/json/css/html/rust/go/sql/yaml/ts/tsx/bash 代码块出现多色语法高亮
- [ ] 亮色 + 暗色都可读（暗色用 one-dark，不再是暗到看不清）
- [ ] markdown 本身的标题/链接/行内码等仍是 Claude 暖色（未被 code 高亮覆盖）
- [ ] 默认（非 Claude）主题不被破坏；mermaid 块仍单色（CM 无 mermaid 语法，可接受）
- [ ] tsc / test / build clean

## Out of Scope
- 把代码 token 配色完全 Claude 化（用 --cm-code-* 令牌）——以后单独做
- mermaid 语法高亮（CM 生态无此语法）
- 全量 language-data
