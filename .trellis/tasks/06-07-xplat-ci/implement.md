# Implement — xplat-ci

> 父 `06-07-cross-platform`；PRD 见 `prd.md`。把 `.github/workflows/release.yml`
> 从仅 Windows 扩成三平台矩阵。依据：Tauri 2 官方 *distribute/Pipelines/github* +
> `tauri-action`（context7 核实 2026-06-07）。
> ⚠ 本任务**无法在本地验证**——唯一验证手段是推一个测试 tag 触发真实 GitHub Actions
> 运行（对外动作；推 tag 前需用户确认，事后清理）。

## 设计（内联，无独立 design.md）

保留现有触发方式 `on: push: tags: ['v*']` 与 `tagName/releaseName = github.ref_name`，
仅把单 job 改成 matrix：

```yaml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: ''
          - platform: macos-latest
            args: '--target universal-apple-darwin'   # 单个通用 dmg：Intel + Apple Silicon 通吃
          - platform: ubuntu-22.04
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - name: install Linux deps (ubuntu only)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target
      - name: Install deps
        run: pnpm install --frozen-lockfile
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: ${{ github.ref_name }}
          releaseDraft: false
          prerelease: ${{ contains(github.ref_name, '-') }}   # v1.4.0-rc.1 → 标为 pre-release
          args: ${{ matrix.args }}
```

**决策点（待用户定）：**
- **macOS 架构**：推荐 `universal-apple-darwin`（单 dmg、两架构通用、用户下载无歧义）。备选：拆 `aarch64` + `x86_64` 两 job（两个更小的 dmg、CI 更快，但用户要选对）。
- **Linux deps**：官方最小集（webkit2gtk-**4.1** + appindicator3 + rsvg2 + patchelf）；Ubuntu 22.04 必须 4.1（4.0 是 Tauri 1）。

## 步骤

- [ ] 用户审阅本计划 + 选定 macOS 架构方案
- [ ] `python ./.trellis/scripts/task.py start 06-07-xplat-ci`
- [ ] 改写 `.github/workflows/release.yml` 为上述 matrix
- [ ] 人工核对 YAML 缩进 / `${{ }}` 表达式（无本地 runner 可跑）
- [ ] **验证（对外，需用户确认）**：推测试 tag `v1.4.0-rc.1` → Actions 三 job 全绿 → 确认该 tag 的 Release 同时挂出 Windows nsis+msi、macOS dmg、Linux deb+appimage
- [ ] 清理：删测试 Release + tag（`gh release delete v1.4.0-rc.1 -y`；`git push --delete origin v1.4.0-rc.1`）
- **回滚**：`git checkout -- .github/workflows/release.yml`

## 风险

- 首次 Linux/macOS 构建可能暴露平台特定编译问题（理论上 foundation 已覆盖；若失败按报错补依赖/配置，可能回流 foundation 或本任务）。
- 通用 macOS 构建需两个 rust target，单 job 偏慢（可接受）。
- 测试 tag 触发真实 Release——务必 rc 形式 + 事后清理，不污染正式版本号。

## 不在本子任务

- 平台真机运行验证（`xplat-linux` / `xplat-macos`）。
- 代码签名 / 公证（D2）。
