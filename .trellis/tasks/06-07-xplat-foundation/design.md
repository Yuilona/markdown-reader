# Design — xplat-foundation

> 父任务 `06-07-cross-platform`；本子任务 PRD 见同目录 `prd.md`。
> 覆盖四块：**A.** data_dir Rust 重构；**B.** 前端路径层去 Windows 化（勘查新增，
> 比 PRD 初稿范围大）；**C.** 键盘 mod 键；**D.** bundle targets。
> 勘查依据（2026-06-07）：`data_dir.rs` / `lib.rs` / `pathUtils.ts` / `persistJson.ts` /
> `logger.ts` / `recentFiles.ts` / `userCss.ts` / `tauri.ts` + Tauri 2 docs（context7）。

## 范围修订（重要）

PRD R1 初稿只写了 Rust 侧 data_dir。勘查发现**前端路径层整体是 Windows 化的**，
其中 `normalizePath` 会让非 Windows 上**文件根本打不开**——比 data_dir 更优先的阻断项。
故 R1 实拆为 **R1a（Rust）+ R1b（前端）**，PRD 已据此补 R1b。

## A. data_dir Rust 重构（R1a）

现状：`data_dir::data_dir() -> PathBuf` 自由函数，基于 `current_exe()`；被 `get_data_dir`
命令（`lib.rs:14`）与 setup（`lib.rs:109`）调用。`app_data_dir()` 需 `AppHandle`。

**方案（选 B：setup 解析一次 + 托管 state）** —— 与既有 `CliLaunchState` / `WatcherState`
托管模式一致，且只解析一次：

```rust
// data_dir.rs
use tauri::{AppHandle, Manager};

#[cfg(windows)]
fn resolve(_app: &AppHandle) -> PathBuf {
    std::env::current_exe().ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .map(|d| d.join("data"))
        .unwrap_or_else(|| std::env::temp_dir().join("markdown-reader-data"))
}

#[cfg(not(windows))]
fn resolve(app: &AppHandle) -> PathBuf {
    // macOS → ~/Library/Application Support/<id>；Linux → $XDG_DATA_HOME 或 ~/.local/share/<id>
    app.path().app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("markdown-reader-data"))
}

pub fn resolve_and_create(app: &AppHandle) -> PathBuf {
    let dir = resolve(app);
    if let Err(err) = std::fs::create_dir_all(&dir) {
        eprintln!("warning: failed to create data dir at {}: {}", dir.display(), err);
    }
    dir
}

pub struct DataDir(pub PathBuf);
```

```rust
// lib.rs
.setup(|app| {
    let dir = data_dir::resolve_and_create(app.handle());
    app.manage(data_dir::DataDir(dir));
    Ok(())
})

#[tauri::command]
fn get_data_dir(state: tauri::State<'_, data_dir::DataDir>) -> String {
    state.0.to_string_lossy().to_string()
}
```

要点 / 权衡：
- **保持优雅降级**（R6/#20/#21）：`current_exe` / `app_data_dir` 失败回退 temp；`create_dir_all` 失败仅 warn 不 panic。
- Windows 行为**逐字节不变**：仍是 exe 同目录 `data/`，`#[cfg(windows)]` 分支保留原逻辑。
- `app_data_dir()` 已含 bundle identifier（`com.yuilona.markdownreader`），无需再拼子目录。
- 解析一次存 state：比"每次命令重算"更省，`get_data_dir` 不再持有 path 逻辑。
- 取 handle 时机：setup 的 `app.handle()`（`&App` → `AppHandle`）——解决 PRD 标注的"自由函数拿不到 handle"。

## B. 前端路径层去 Windows 化（R1b，勘查新增）

**问题清单（file:line）：**
1. `pathUtils.ts:11-13` `normalizePath` 把 `/`→`\`。被 `tauri.ts` loadDocument(91)/saveDocument(136)/saveAsDocument(199) 调用 → 非 Windows 上 `/Users/x/foo.md` 变 `\Users\x\foo.md`，**文件打不开。阻断级。**
2. `pathUtils.ts:16-18` `pathsEqual` 强制小写比较（Windows 语义）→ Linux 区分大小写会误判。
3. `persistJson.ts:73-74` `joinDataPath` 用 `${dir}\\${name}`。
4. `logger.ts:114` `${dataDir}\\${LOG_DIR_NAME}`。
5. `recentFiles.ts:135` `${dir}\\${tmpName}`。
6. `userCss.ts:49,57`（及该文件其余）`${dir}\\user.css` 等。

**方案：**
- **数据目录拼接（3/4/5/6）**：新增 `joinUnder(dir, name)` 于 `pathUtils`，**从 `dir` 字符串推断分隔符**：`dir.includes('\\') ? '\\' : '/'`。理由——Windows 绝对路径必含 `\`（盘符/UNC），posix 绝对路径只含 `/`；推断零依赖、同步，且**现有测试（`logger.test`/`userCss.test` 用 `C:\app\data` 夹具）继续走 `\`、无需改动**。6 处全改调 `joinUnder`。
- **normalizePath / pathsEqual（1/2）**：改平台感知，需同步的 `IS_WINDOWS`/`IS_MAC`。
  - 探测（**推荐 navigator UA**，零依赖、同步、import 期可用）：
    ```ts
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    export const IS_WINDOWS = ua.includes('Windows');
    export const IS_MAC = /Macintosh|Mac OS X/.test(ua);
    ```
    备选：`@tauri-apps/plugin-os` 的 `platform()`（v2 同步）——更"官方"但需加插件 + capability + 处理 import 期时机；仅为分隔符判断不值这成本。
  - `normalizePath`: `IS_WINDOWS ? p.replace(/\//g,'\\') : p`（posix 恒等）。
  - `pathsEqual`: `IS_WINDOWS || IS_MAC ? 小写比较 : 区分大小写`。
- 删 `pathUtils` 顶部 "v0.1 is Windows-only … flag for later" 注释，改跨平台说明。

**测试影响**：jsdom 的 UA 既非 Windows 也非 Mac → `IS_WINDOWS=false` → `normalizePath` 走 posix 恒等。无 `pathUtils.test.ts`（已确认）。`scrollPositions.test` 走 `persistJson`，`joinUnder` 从 dir 推断，Windows 夹具不受影响——implement 复跑确认。

## C. 键盘 mod 键（R2 / D6）

- 复用 B 节 `IS_MAC`。`useShortcuts.ts` 顶部：`const mod = (e: KeyboardEvent) => (IS_MAC ? e.metaKey : e.ctrlKey);`
- 所有 `e.ctrlKey` 判断（约 13 处）→ `mod(e)`；`!e.shiftKey && !e.altKey` 等保留。
- 裸键（F5/F11）与 `Ctrl+\`、`Ctrl+=/-/0` 同样走 `mod`。
- CM6 内置 `Mod-f`/`Mod-s` 已自动映射 ⌘，无需改；`isInCodeMirror` gate 保留。
- 注释更新：删 "Ctrl+O on Windows; … v0.1 is Windows-only"。

## D. bundle targets（R3）

- `tauri.conf.json` `bundle.targets`: `["nsis","msi"]` → `"all"`。各平台产原生包：Windows nsis+msi（不变）、macOS app+dmg、Linux deb+rpm+appimage。
- 无需 macOS/Linux 额外 bundle 配置即可出未签名包（D2）。CI（`xplat-ci`）如需收窄（只 deb+appimage）用 tauri-action `args: --bundles ...` per-job，不在本子任务。
- 验证 Windows：`pnpm tauri build` 仍只产 nsis+msi（"all" 在 Windows = 这两者）。

## 不在本子任务

- 平台真机冒烟（linux/macos 子任务）、CI 矩阵（xplat-ci）、macOS 交通灯标题栏（xplat-macos）。

## 风险

- UA 在极少数自定义 WebView 下被改 → 分隔符判断退化；但 `joinUnder` 的 dir 推断不依赖 UA，且 normalizePath posix 恒等是安全默认。
- `app_data_dir()` 在某些精简 Linux 环境可能 Err → 已回退 temp。
- 改 `normalizePath` 仅影响 Windows 既有 recent.json 键匹配——但 Windows 分支行为不变，无影响。
