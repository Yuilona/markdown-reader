# CR-Cleanup: dead code / unused deps / stale files

> 父任务：`05-30-code-review-remediation`。来源发现：#12 #18 #19 #25 #26。
> 证据见父任务 `research/findings-full-2026-05-30.md` 对应 `### [N]` 小节。
> 全部为低风险清理；删除前每项都已用 grep/git/diff 核实「确实未用」。

## Goal

删掉审查确认的死代码、无用 npm 依赖、stale 文件，降低噪音与维护负担，**不改变任何运行行为**。

## What I already know（已核实）

- **#12** `remark-frontmatter` 是死的：`DocumentView.tsx` 总是先 `splitFrontmatter` 剥掉
  frontmatter 再喂给 `<Markdown>`，`markdownPlugins.ts:69` 的 `[remarkFrontmatter,['yaml']]`
  永远没有 frontmatter 节点可解析（仅 1 处 `<Markdown>`、1 处 remarkPlugins 消费者，均喂 post-split body）。
- **#18** `yaml`（package.json:58）**零直接引用**：`grep -rE "from '(yaml)'" src/` 无命中；
  frontmatter 从不被反序列化（`Frontmatter.tsx:58-59` 原样渲染 `<pre><code>`）。`@shikijs/langs/yaml`、
  `@codemirror/lang-yaml` 是另两个包，不受影响。
- **#19** `@codemirror/search`（package.json:28）**直接依赖冗余**：src 无 import，运行时经
  `@uiw/react-codemirror` 的 basicSetup 传递性提供。删除属依赖卫生（无 bundle 影响），优先级低于 #18。
- **#25** 不可达死分支：`resolveImageSrc` 的 `data:`/`blob:` 图片分支（`DocumentView.tsx:619-620`）
  与 `PROTOCOL_PREFIXES` 的 `sms/ftp/ftps`——因 react-markdown 先 blank 非 safeProtocol，body
  来源的这些永远到不了。`http(s)` 图片透传**是活的**（远程图，勿删）。
  > 注：`sms/ftp/ftps` 前缀的清理与 `cr-security` R3 重叠——**由 `cr-security` 负责该前缀清理**，
  > 本任务只处理 `data:`/`blob:` 图片死分支，避免两个子任务改同一处冲突。
- **#26** 根目录 `vite.config.js`（4647B）是 `tsc -b` 的 stale 编译产物：`git ls-files` 只跟踪
  `vite.config.ts`，`.gitignore` 已忽略 `vite.config.js`/`vite.config.d.ts`，`diff` 二者仅缩进差异，
  Vite 解析 `.ts` 优先、从不加载该 `.js`。纯磁盘残留。

## Requirements

### R1（#18）移除未用依赖 `yaml`
- 从 `package.json` 删 `"yaml"`，`pnpm install` 重写 lockfile。build/test 验证。

### R2（#12）移除死插件 `remark-frontmatter`
- 删 `markdownPlugins.ts` 的 import 与 `[remarkFrontmatter,['yaml']]` 条目；从 package.json
  移除 `remark-frontmatter` 依赖。行为零变化（已证明永不执行）。
- 移除后复测 frontmatter 渲染（折叠卡片）仍正常。

### R3（#25）移除不可达图片协议死分支
- 删 `resolveImageSrc` 中 `data:`/`blob:` 透传分支（body 图片到不了）；**保留** `http(s)` 透传。
- 同步修正 `DocumentView.tsx:602` 附近声称支持 `data:`/`blob:` 的注释。
- 若确有「内联 data: 图片」需求，则改为显式自定义 `urlTransform`——但这是新功能，**不在本任务**（默认按死分支删除）。

### R4（#26）删除 stale `vite.config.js`
- 删除磁盘上的 `vite.config.js`（未跟踪、已 gitignore、从不加载）。可选：调整 `tsconfig.node.json`
  让 `tsc -b` 不再 emit 它（非必须）。

### R5（#19，可选）`@codemirror/search` 直接依赖
- 可选移除直接依赖（仍经 @uiw 传递性可用）。若保留，加注释说明为何留着显式 pin。
  默认**保留并加注释**（去掉会丢版本 pin、收益纯卫生）。

## Acceptance Criteria

- [x] `package.json` 不再含 `yaml`、`remark-frontmatter`；`pnpm install` 剪掉 2 直接依赖（连带 −6 子依赖），lockfile 干净
- [x] `markdownPlugins.ts` 无 `remark-frontmatter`（import + 插件项 + 注释均移除）；frontmatter 仍由上游 `splitFrontmatter` 剥离、`Frontmatter.tsx` 折叠卡片渲染路径不变
- [x] `resolveImageSrc` 无 `data:`/`blob:` 死分支（保留 http(s)），注释更正；唯一调用方 img override（`DocumentView.tsx:574`），body 图永远拿不到 data:/blob:（被 `defaultUrlTransform` blank）
- [x] 磁盘 `vite.config.js` 已删，并在 `tsconfig.node.json` 加 `emitDeclarationOnly` 让 `tsc -b` 不再 emit `.js`（改产出 gitignored 的 `.d.ts`）；`tsc -b --force` 验证后 `vite.config.js` 不再出现，`pnpm build` 正常
- [x] #19 决定：**保留** `@codemirror/search`（运行时经 @uiw basicSetup 传递性使用；移除仅丢版本 pin、无 bundle 收益）
- [x] `pnpm exec tsc --noEmit`(0) + `pnpm test`(44/44) + `pnpm build`(ok) 全通过；grep 确认 src 无遗留引用；无运行行为变化

> 建议（可选）：在 app 内对一份含 YAML frontmatter + 本地相对图片 + 远程图片的文档做一次目检，确认渲染与改动前一致。

## Out of Scope

- `sms/ftp/ftps` 协议前缀清理（归 `cr-security` R3）
- Sarasa 0 字节占位字体的处理（已在 docs 中说明，且涉及默认主题字体回退链，单列；本轮不动）
- 任何会改变运行行为的「清理」

## Technical Notes

- 删依赖后务必 `pnpm install` + 全量 `tsc`/`test`/`build`，确保没有遗漏的间接引用。
- R3 改注释时连同 #25 在 findings 里的「http(s) 透传是活的」一并核对，别误删远程图能力。
