# Support absolute local image/link paths (urlTransform passthrough)

> 来源:用户在 `06-10-raw-html-render` 冒烟后提出"同时支持绝对路径会不会更好"。
> 结论(已讨论确认):做。安全增量≈0(相对 `../` 穿越 + asset scope `**` 已能读任意
> 文件),主要是便利性提升;唯一缺点是绝对路径文档不可移植(作者自负)。

## Goal

让文档中的**绝对本地路径图片/链接**也能工作:Windows 盘符(`C:\…` / `C:/…`)、
UNC(`\\server\…`)、POSIX 绝对(`/abs/…`)。当前被 react-markdown 的
`defaultUrlTransform` 当作 URL 协议(`C:` → scheme)抹掉 src/href。

## 背景 / 根因

- react-markdown v10 对所有 url 属性跑 `defaultUrlTransform`:`C:/x.png` 的 `C:` 被当成不安全协议 → src 被抹空 → 图不加载(`06-10-raw-html-render` 冒烟已实证)。
- POSIX 绝对(`/abs`)其实**已被** `defaultUrlTransform` 放行(无冒号),所以只缺 Windows 盘符 + UNC。
- `resolveImageSrc`(`isWinAbs` 分支)与 `linkRouter`(`resolveLocalPath`)**早已支持**绝对路径,只是值在上游被抹了到不了它们。

## Requirements

- **R1** 自定义 `urlTransform`:在 `defaultUrlTransform` 基础上**额外放行**绝对盘符 `^[A-Za-z]:[\\/]` 与 UNC `^\\\\`;其余(含 `javascript:`/`data:`/`vbscript:`)仍按 default 抹掉。POSIX 绝对沿用 default(已放行)。
- **R2** 确保 `sanitize` 不把绝对路径 src/href 抹掉(若 sanitize 也按协议抹 `C:` → 需放宽 src/href 的协议校验,改由 urlTransform + `resolveImageSrc`/`linkRouter` 兜底)。**实现时先实测 sanitize 是否真会抹,再决定是否动 schema。**
- **R3** 不削弱对 `javascript:`/`data:` 的拦截(urlTransform + img/a 处理层仍挡)。
- **R4** 零回归:相对路径、http(s)、`http://asset.localhost` 本地图、anchor、mailto 全照常。

## Acceptance Criteria

- [ ] 文档里 `![](C:/x.png)`、`<img src="D:\y.png">`、`\\server\share\z.png` 能解析出 src 并经 `resolveImageSrc` → asset 加载(真机/构建验证)。
- [ ] `javascript:`/`data:` 在 img src 与 a href 上仍被抹掉/无效(单测断言)。
- [ ] 相对路径、http(s)、anchor、mailto 无回归;`06-10-raw-html-render` 的 XSS 必杀清单仍全绿。
- [ ] `tsc` + `pnpm test`(新增 urlTransform 单测 + 管线测试)通过;`pnpm tauri build` 成功。

## Out of Scope

- `file://` 协议(`resolveImageSrc` 不处理,保持抹掉)。
- 把 asset scope 收窄(独立安全话题,本任务不动)。

## Notes

- 安全权衡见 design;关联 [[已存在的严格 sanitize 决策 / project_raw_html_sanitize]]。
