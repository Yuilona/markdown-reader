# 执行计划

## 顺序清单

1. [ ] 新建 `src/lib/escapeCurrencyMath.ts` — 导出 `escapeCurrencyMath(md)`,实现 design.md 的单次 replace 跳过模式。
2. [ ] 新建 `src/lib/escapeCurrencyMath.test.ts` — 命中 / 真公式不命中 / 跳过代码 / 幂等 四组用例。
3. [ ] 接线 `DocumentView.tsx` — 在 body 文本传给 `<Markdown>` 之前调用 `escapeCurrencyMath`。定位现有把 body 作为 children 渲染的位置(注意 source-line 两遍盖章依赖原始行号:确认转义不改变行数 —— 仅插入 `\` 字符、不增删换行,行号稳定)。
4. [ ] `src/styles/global.css` 追加 `.katex-display` 覆盖段(overflow-x:auto + padding + margin)。
5. [ ] 校验命令(见下)。
6. [ ] 版本 bump 到 1.4.2(package.json / tauri.conf.json / Cargo.toml;Cargo.lock 由 cargo 更新或手动同步)。
7. [ ] 归档任务(auto-commit),推送,CI 自动出三平台包并发布 v1.4.2。release notes 晚点贴(沿用 v1.4.1 做法)。

## 校验命令

```bash
pnpm test                 # 全绿:新货币用例 + 既有 XSS/绝对路径/管线测试
pnpm build                # tsc -b && vite build 通过
# Rust 侧无改动,无需 cargo build;若 bump 了 Cargo.toml 则 cargo check 同步 Cargo.lock
```

## 复核要点(review gate)

- 转义函数**不改行数**(source-line 行号映射依赖):只插入 `\`,不动换行符。
- 货币正则**点两侧无空格**这一条是区分真公式的关键,测试必须含 `$0 = b_0` 与 `$1 . 0` 反例。
- 代码跳过:`samples/HiPER.md` 行1185–1199 的 ```txt 块务必保持原样。
- CSS 仅加 `.katex-display`,不动 `.katex`(行内公式)本身,避免影响行内数学基线。

## 回滚点

- 第 3 步接线后若 source-line / 编辑联动异常 → 撤销 DocumentView 接线即可(函数与测试可保留)。
- 第 4 步 CSS 若导致行内或 mermaid 异常 → 删除追加段。

## 真机/可视验证

- 用安装版打开 `samples/GoS.md`:第 174 段不再溢出、货币字面。
- 打开 `samples/HiPER.md`:(19)(20) 编号不重叠、宽公式可滚动、间距合适;`$0 = b_0 < \dots$` 仍是公式。
- 沿用"我给截图/你确认"的可视回归流程。
