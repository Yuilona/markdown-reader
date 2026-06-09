# Implement — absolute-paths

> 顺序执行;依据 design.md。`task.py start` 后动手。

## 前置
- [ ] `task.py start 06-10-absolute-paths`
- [ ] 基线绿:`tsc` + `pnpm test`

## 步骤
- [ ] 新建 `src/lib/urlTransform.ts`(见 design;包 `defaultUrlTransform` + 绝对盘符/UNC 放行)
- [ ] 新建 `src/lib/urlTransform.test.ts`(纯函数单测:放行绝对/相对/http(s);抹 javascript:/data:/vbscript:/`//host`)
- [ ] `DocumentView.tsx`:`import { urlTransform }`;`<Markdown … urlTransform={urlTransform}>`
- [ ] **实测 sanitize**:在 `markdownPipeline.test.tsx` 加一例——绝对路径 HTML `<img src="E:/x/y.png">` 经 `[rehypeRaw, [rehypeSanitize, sanitizeSchema]]` + `urlTransform` 渲染,断言 src 存活。
  - 若存活 → 无需动 `sanitizeSchema.ts`。
  - 若被抹 → 改 `sanitizeSchema.ts`:`protocols` 仅保留非 href/src 键(`Object.fromEntries(... filter k!=='href'&&k!=='src')`),重测。
- [ ] 加管线断言:`javascript:`/`data:` 在 img src 仍被抹(经 urlTransform)。
- 验证:`pnpm exec tsc --noEmit` && `pnpm test`
- 回滚:`git checkout -- src/components/DocumentView/DocumentView.tsx src/lib/sanitizeSchema.ts` + 删新文件

## 收尾
- [ ] `pnpm tauri build` 成功
- [ ] 真机/构建冒烟:`![](C:/…)` / `<img src="D:\…">` 加载;相对/http(s)/anchor 无回归;XSS 必杀仍绿
- [ ] 提交;按需 `task.py archive`
- [ ] 更新测试 md(可选):把 1c 那条"绝对路径预期占位"改成"现在也能加载"
