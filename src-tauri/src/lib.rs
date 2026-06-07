mod data_dir;
mod file_watcher;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Emitter, Manager, State};

use file_watcher::WatcherState;

/// Tauri command exposed to the frontend.
/// Returns the absolute path of the portable data directory as a string.
#[tauri::command]
fn get_data_dir(state: State<'_, data_dir::DataDir>) -> String {
    state.0.to_string_lossy().to_string()
}

/// Holds the CLI-launch markdown path (if any). Read by the frontend once
/// on mount via `take_cli_launch_path`; the take semantics ensure we only
/// open the file once even if hot-reload re-mounts the React tree.
#[derive(Default)]
struct CliLaunchState(Mutex<Option<String>>);

#[tauri::command]
fn take_cli_launch_path(state: State<'_, CliLaunchState>) -> Option<String> {
    // R8 (#27): recover from a poisoned lock via into_inner() (consistent with
    // the file watcher) so a one-time panic can't permanently break CLI launch.
    let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    guard.take()
}

/// Start watching a file for external modifications. Replaces any
/// previously-watched file. Emits a `file-changed` event (debounced 200ms)
/// when the target is modified.
#[tauri::command]
fn start_watching(
    app: tauri::AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    file_watcher::start_watching(&state, &app, path)
}

/// Stop watching the currently-watched file. No-op if nothing is watched.
#[tauri::command]
fn stop_watching(state: State<'_, WatcherState>) -> Result<(), String> {
    file_watcher::stop_watching(&state)
}

/// Extract the first non-flag argument that looks like a markdown file path
/// and exists on disk. Returns `None` for the common "no file passed" case
/// and for misconfigured associations that pass us a `.txt` or similar.
///
/// PR-5a: case-insensitive extension match (`.md` / `.markdown`). The
/// existence check uses `try_exists` so a permission error doesn't panic.
fn first_markdown_arg<I>(args: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = String>,
{
    for arg in args.into_iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(&arg);
        let ext_ok = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| {
                let lower = s.to_ascii_lowercase();
                lower == "md" || lower == "markdown"
            })
            .unwrap_or(false);
        if ext_ok && path.try_exists().unwrap_or(false) {
            return Some(path);
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Capture the first-launch CLI path BEFORE building the app so the state
    // is populated by the time `setup` runs.
    let cli_path: Option<String> = first_markdown_arg(std::env::args())
        .map(|p| p.to_string_lossy().to_string());

    let result = tauri::Builder::default()
        .manage(CliLaunchState(Mutex::new(cli_path)))
        .manage(WatcherState::new())
        // Single-instance plugin: when a second copy is launched, forward its
        // argv to the running window via a "second-instance" event and bring
        // the window to the foreground. PR-5a wires the frontend listener
        // to actually load the file.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("second-instance", args);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // PR-5b: shell plugin powers R7 link routing (`shell.open` for
        // http/https/mailto + non-md local files).
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Resolve the platform data dir once (Windows: portable, next to
            // the exe; macOS/Linux: OS app-data dir) and cache it in managed
            // state. Also creates it on first launch.
            let dir = data_dir::resolve_and_create(app.handle());
            app.manage(data_dir::DataDir(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            take_cli_launch_path,
            start_watching,
            stop_watching,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        // R7 (#22): release builds detach the console (windows_subsystem=
        // "windows"), so a panic here would make the process vanish silently —
        // most commonly when the WebView2 runtime is missing on the target
        // machine. Surface the cause in a native dialog instead of vanishing.
        report_fatal_startup_error(&err.to_string());
        std::process::exit(1);
    }
}

/// R7 (#22): show a native error dialog on a fatal startup failure. Release
/// builds set `windows_subsystem = "windows"` (no console), so without this a
/// `run()` error — e.g. a missing WebView2 runtime — would make the process
/// vanish with no diagnostic. Windows-only native MessageBoxW (no extra
/// crate); other targets just log to stderr.
#[cfg(windows)]
fn report_fatal_startup_error(message: &str) {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    // MB_OK | MB_ICONERROR
    const MB_ICONERROR: u32 = 0x0000_0010;
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut c_void,
            text: *const u16,
            caption: *const u16,
            u_type: u32,
        ) -> i32;
    }

    let text = wide(&format!(
        "Markdown Reader 启动失败：\n{message}\n\n请确认系统已安装 WebView2 运行时。"
    ));
    let caption = wide("Markdown Reader");
    // SAFETY: valid NUL-terminated UTF-16 buffers that outlive the call, a null
    // owner hwnd, and a known message-box flag — a standard user32 call.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_ICONERROR,
        );
    }
    eprintln!("[startup] fatal: {message}");
}

#[cfg(not(windows))]
fn report_fatal_startup_error(message: &str) {
    eprintln!("[startup] fatal: {message}");
}
