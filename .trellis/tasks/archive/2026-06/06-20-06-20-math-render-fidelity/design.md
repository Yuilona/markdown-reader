# 技术设计:货币 $ 转义 + KaTeX display 样式

## 概览

两处互相独立的修复:

- **A. 货币转义预处理**(解析层):在 Markdown body 进入 react-markdown 之前,把"货币金额"的 `$` 转义为 `\$`,使 remark-math 不再把它当行内公式定界符。
- **B. KaTeX display 样式**(展示层):在 `global.css` 增加 `.katex-display` 覆盖,解决宽公式溢出、`\tag` 编号重叠、连续公式间距。

## A. 货币转义

### 放在哪

新文件 `src/lib/escapeCurrencyMath.ts`,导出纯函数 `escapeCurrencyMath(md: string): string`。在 `DocumentView.tsx` 里、body 文本交给 `<Markdown>` 之前调用(即把当前传入 children 的 body 串先过一遍此函数)。选预处理而非 remark 插件的原因:remark-math 在 micromark(语法)层就把货币吞成 `inlineMath` 节点,等到 mdast 阶段(remark 插件能介入处)已太迟;字符串级转义是最早、最可靠的介入点。

### 算法

单次 `String.replace`,用"先吃掉代码、否则匹配货币"的经典跳过模式,保证不碰代码:

```ts
const TOKEN = new RegExp(
  [
    '```[\\s\\S]*?```',      // 围栏代码块(```)
    '~~~[\\s\\S]*?~~~',      // 围栏代码块(~~~)
    '`[^`\\n]*`',            // 行内代码
    '\\\\\\$',               // 已转义的 \$ —— 原样保留,不再处理
    // 货币:$ 紧跟 [千分位整数|整数].小数,中间无空格
    '\\$(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{1,2}',
  ].join('|'),
  'g',
);

export function escapeCurrencyMath(md: string): string {
  return md.replace(TOKEN, (m) =>
    m.startsWith('$') ? '\\' + m : m,   // 仅货币分支以 $ 开头 → 加反斜杠转义
  );
}
```

要点:
- 代码块/行内代码/`\$` 分支匹配后**整体原样返回**(`m` 不以 `$` 开头,直接 return),从而"消费"掉这些区域,货币正则不会在其中再命中。
- 仅货币分支以 `$` 开头,命中后返回 `'\\' + m`,即 `$0.94` → `\$0.94`,remark-math 视为字面 `$`。
- 货币模式要求 `$数字…小数`、**点两侧无空格**。这天然排除真公式:`$0 = b_0`(`$0 ` 后是空格无小数点)、`$1 . 0`(`1` 与 `.` 间有空格)均不匹配。
- 千分位 `\d{1,3}(?:,\d{3})+` 在前(优先匹配 `$1,000.00`),否则退化为 `\d+`。
- 小数 `\d{1,2}` 覆盖样本中 `$29.2`(1 位)与 `$16.05`(2 位)。

### 不变量 / 安全

- 不改变任何真公式、不放宽 sanitize、不触达文件系统或 shell。纯文本 → 文本变换。
- `convertFileSrc`/CSP/urlTransform 全不涉及。

## B. KaTeX display 样式

### 放在哪

`src/styles/global.css` 追加一段 `.katex-display` 规则。该文件在 `main.tsx` 中于 `katex.min.css`(DocumentView 内 import)之后参与打包;`.katex-display` 选择器与 KaTeX 默认同特异性(0,1,0),后到者胜,覆盖生效。用户本地 `user.css` 仍可再覆盖(注入在最后),互不冲突。

### 规则

```css
.katex-display {
  overflow-x: auto;        /* 宽公式横向滚动,不溢出列宽;\tag 编号随之回到右缘 */
  overflow-y: hidden;
  padding-top: 0.25em;
  padding-bottom: 0.5em;   /* 给横向滚动条 + 下伸笔画留空间,避免裁切 */
  margin-top: 1.2em;       /* 连续 display 公式更舒展 */
  margin-bottom: 1.2em;
}
```

- `overflow-x: auto` 是 KaTeX 官方推荐的宽公式处理方式;公式整体进入可滚动视口,`\tag` 编号定位在公式自身右缘,不再压到内容。
- 不动 array 内部 `\\` 行距(属文档 LaTeX)。

## 测试

新文件 `src/lib/escapeCurrencyMath.test.ts`(vitest,node 环境即可,纯字符串):
- 命中:`($0.94/case)`、`$16.05 to $40.98`、`$29.2`、`$1,000.00` → `$` 被转义。
- 不命中(真公式):`$0 = b_{0} < \dots$`、`$1 . 0$`、`$h_t^*$` → 原样不变。
- 跳过代码:```` ```txt\n'$16.05 to $40.98'\n``` ````、行内 `` `$9.99` `` → 内部 `$` 不被转义。
- 幂等:已含 `\$0.94` 不被二次转义。

CSS 无法单测,靠 `pnpm build` 通过 + 用户真机/截图确认(沿用既有可视回归流程)。

## 回滚

两处改动彼此独立且都是新增/纯增量:回滚 = 撤销新文件 import + 删除 global.css 追加段。无数据/格式迁移。
