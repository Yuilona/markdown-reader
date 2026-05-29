# CR-Security: shell.open hardening（保持本地文件打开禁用）

> 父任务：`05-30-code-review-remediation`。来源发现：#2 #5 #23 #24（关联 #25 #28）。
> 证据见父任务 `research/findings-full-2026-05-30.md` 对应 `### [N]` 小节。
> 威胁模型：用户打开的**恶意 .md** 能否触发代码执行/外部程序调用。

## Goal

消除「恶意 .md 单击链接→`shell.open` 启动任意本地可执行文件」的攻击面，并把
shell.open 的真实校验边界显式化。采纳决策 **D1：保持本地非 .md 文件打开禁用 + 清理**。

## What I already know（已核实）

- **#2（High）**：`linkRouter.ts:82-85` 把任意非 .md 本地路径分类为 `local-other`，
  `:197-204` 对其调用 `shellOpen(absolutePath)`，**无扩展名白/黑名单、单击即触发、
  无确认**。点击绑定在 `DocumentView.tsx:562`。
- **#5（Low/功能）**：但**当前其实打不响**——`tauri.conf.json` 没有 `plugins.shell.open`，
  插件用内置默认正则 `^((mailto:\w+)|(tel:\w+)|(https?://\w+)).+`，本地路径
  （`C:\...`/UNC）一律不匹配 → `shellOpen` 总是抛 Validation 错 → 弹「无法打开文件/图片」。
  所以 `local-other` 链接打开 + 图片右键「在系统中打开」(`documentActions.ts:176-194`
  `openImageInSystem`) 是**死功能**，同时也意外挡住了 #2。
- **#24（Low）**：`capabilities/default.json` 的 `shell:allow-open` `allow:[{url},{path:'**'}]`
  只决定命令**能否被调用**，**不参与** open 的值校验（tauri-plugin-shell 2.3.5 只认
  `plugins.shell.open` 正则）。所以那份 allow 列表 + `default.json` 里描述其「治理链接路由」
  的注释是**误导性死配置**。
- **#23（Low + 死代码）**：`PROTOCOL_PREFIXES = ['mailto:','tel:','sms:','ftp:','ftps:']`
  （`linkRouter.ts:55`）里 `sms/ftp/ftps`（以及 md 链接场景下的 `tel:`）**永远到不了**——
  react-markdown 的 `defaultUrlTransform` 用 `safeProtocol=/^(https?|ircs?|mailto|xmpp)$/i`
  在 override 之前就把它们 blank 成 `''`。`mailto:` 能通过，点击会启动系统邮件处理器
  （影响有限：预填字段，非 argv 注入）。
- **#28（Info，好消息）**：管线**无 raw-HTML/XSS 注入点**（未用 rehype-raw、无
  `allowDangerousHtml`，`javascript:`/`data:text/html` 等被 blank，KaTeX `trust=false`）。
  本任务**不需要**为 XSS 做任何事；仅记录以防过度修复。

## Requirements

### R1（#2 + #5 + D1）禁用并清理本地非 .md 文件打开
- 移除（或短路）`linkRouter.ts` `local-other` 分支里的 `shellOpen(absolutePath)` 调用：
  本地非 .md 文件**不再尝试用系统程序打开**。
- 移除图片右键菜单的「在系统中打开」项及 `documentActions.openImageInSystem`
  （或同样短路），避免暴露一个总是报错的动作。
- 错误/交互文案：把原来的「无法打开文件/图片」改成更准确的提示，方向取其一：
  「不支持打开此类文件」或「在文件夹中显示」（reveal-in-folder，若实现成本可接受则更佳）。
  最终文案在 implement 阶段定；本 PRD 只要求不再静默走 `shellOpen` + 不再误导。
- 结果：恶意 `[x](evil.hta)` / `![x](evil.exe)` 单击**不触发任何 shellOpen**。

### R2（#24 + D2）显式化 shell.open 校验
- 在 `tauri.conf.json` 增加 `plugins.shell.open`，设为**刻意收窄**的正则
  （仅放行 http(s)/mailto，例如 `^(https?://|mailto:).+`），不要设 `true` 或宽松 Validate。
- 在 `capabilities/default.json` 加注释说明：此插件版本下 `allow` 项**不**校验 open 的值，
  真正的值校验在 `plugins.shell.open`；并清理/修正 `default.json:4` 那条误导性注释。
- 若 `path:'**'` allow 项在 R1 之后已无实际用途，评估移除（保守起见可保留但加注释）。

### R3（#23）清理死协议前缀
- 从 `PROTOCOL_PREFIXES` 移除 `sms:` / `ftp:` / `ftps:`（md 链接永远到不了）。`tel:`
  同理对 md 链接是死的——按是否还想支持非 md 来源决定去留（默认随 D2 的正则一起收窄）。
- `mailto:` 保留（UX 需要）。是否在启动 mailto 前加确认弹窗为**可选**，默认不加（影响有限）。

## Acceptance Criteria

- [ ] 构造性验证：恶意 .md 内 `[open](evil.hta)`、相对路径 `bin/x.exe`、`![i](x.scr)` 单击/查看
      **均不调用 `shellOpen`**（代码路径上 `local-other`/图片 open 已无 shellOpen）
- [ ] 图片右键不再出现总是报错的「在系统中打开」；本地非 .md 链接点击给出准确反馈
- [ ] `tauri.conf.json` 含显式 `plugins.shell.open` 收窄正则；`http(s)`/`mailto` 链接仍正常打开
- [ ] `capabilities/default.json` 注释更正（allow 不校验 open）
- [ ] `PROTOCOL_PREFIXES` 不再含 `sms/ftp/ftps`
- [ ] `pnpm exec tsc --noEmit` + `pnpm test` 通过；动到 Rust/config 后 `cargo check` 通过
- [ ] README / 文档中若提到「本地文件用系统程序打开」的能力，同步更正

## Out of Scope

- 重新启用本地文件打开（D1 明确否决；若将来要做，必须配套扩展名黑名单 + 确认弹窗）
- 迁移到 tauri-plugin-opener
- XSS/raw-HTML 相关改动（#28 确认无需）
- 收紧 fs scope

## Technical Notes

- `defaultUrlTransform` 的 `safeProtocol` 决定了哪些协议能到达 override，是本任务很多
  「死分支」结论的根因——改动前先理解这层，避免给永远到不了的分支加逻辑。
- Rust 侧 `app.shell().open(path, None)` 可绕过 JS scope 校验——**本任务不采用**该路径
  （那等于变相重新启用本地打开，与 D1 冲突）。
