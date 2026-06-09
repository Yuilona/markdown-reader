# Design — absolute-paths

## 方案

新建 `src/lib/urlTransform.ts`(纯函数,可单测),在 `DocumentView.tsx` 的 `<Markdown>`
上加 `urlTransform={urlTransform}` prop。视 sanitize 实测结果决定是否放宽 `sanitizeSchema.ts`
的 src/href 协议校验。

## urlTransform.ts

```ts
import { defaultUrlTransform } from 'react-markdown';

// Windows drive (C:\ / C:/) or UNC (\\server\…). POSIX-absolute (/abs) needs no
// special-case — defaultUrlTransform already allows it (no colon before slash).
const ABSOLUTE_LOCAL = /^[a-zA-Z]:[\\/]/;

export function urlTransform(url: string): string {
  if (ABSOLUTE_LOCAL.test(url) || url.startsWith('\\\\')) return url; // keep; gated downstream
  return defaultUrlTransform(url); // safe protocols + relative; blanks javascript:/data:/unknown
}
```

`defaultUrlTransform` is a named export of react-markdown v10 (verified). The prop
is a module constant → no impact on the `markdownEl` useMemo deps.

## 顺序与为什么 sanitize 可能要动

- 链中 `rehype-sanitize` 在 **rehype 阶段**运行;`urlTransform` 在 react-markdown 的
  **hast→React 渲染阶段**(rehype 之后)运行。所以 sanitize **先**看到原始 `C:/…`。
- 若 hast-util-sanitize 按协议抹 `C:`(很可能),那么即使 urlTransform 放行,src 也已被
  sanitize 抹空 → 必须同时放宽 sanitize。
- **实测优先**:先只加 urlTransform + 测试一个绝对路径 img 经 `[rehypeRaw, sanitize]` +
  自定义 urlTransform 后 src 是否存活。存活→无需动 schema;被抹→动 schema。

### 若需动 schema(`sanitizeSchema.ts`)

移除 `protocols` 中的 `href` / `src` 键(其余协议键保留):hast-util-sanitize 仅对
`protocols` 里列出的属性做协议校验,移除后 src/href 不再被协议过滤 → 绝对路径存活。
安全由其余层兜底:
- `urlTransform`(渲染期)仍抹 `javascript:`/`data:`/`vbscript:`/未知协议。
- `resolveImageSrc`:img 仅放行 http(s) + 绝对本地 → convertFileSrc;其余 → undefined。
- `linkRouter`:a 仅路由 http(s)/mailto/anchor/local-md;local-other 拒绝。

这是"严格姿态松半格"(src/href 少一层协议纵深),但实际 `javascript:`/`data:` 仍被
urlTransform + 处理层双挡。用户已知情同意。

## 安全权衡(已与用户确认)

- **无新文件可达面**:相对 `../` 穿越 + asset scope `**` 早已能读任意文件;绝对路径不扩大。
- **代价**:绝对路径文档不可移植(作者选择);src/href sanitize 协议纵深 -1 层(若需动 schema)。

## 测试

- `urlTransform.test.ts`(纯函数):放行 `C:/`,`C:\`,`\\unc\`,`/posix`,相对,http(s);
  抹 `javascript:`,`data:`,`vbscript:`,protocol-relative `//host`(default 行为)。
- 管线测试(`markdownPipeline.test.tsx`):绝对路径 img 经全链 + 自定义 urlTransform 后
  src 存活;`javascript:`/`data:` 仍被抹。

## 风险

- 若误把 sanitize 协议校验整个移除(而非仅 href/src)→ 过度放宽;务必只删这两键。
- `defaultUrlTransform` 若未来 react-markdown 改名/语义变 → urlTransform 退化;单测兜底。
