mod data_dir;
mod file_watcher;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Emitter, Manager, State};

use file_watcher::WatcherState;

/// Tauri command exposed to the frontend.
/// Returns the absolute path of the portable data directory as a string.
#[tauri::command]
fn get_data_dir() -> String {
    data_dir::data_dir().to_string_lossy().to_string()
}

/// Holds the CLI-launch markdown path (if any). Read by the frontend once
/// on mount via `take_cli_launch_path`; the take semantics ensure we only
/// open the file once even if hot-reload re-mounts the React tree.
#[derive(Default)]
struct CliLaunchState(Mutex<Option<String>>);

#[tauri::command]
fn take_cli_launch_path(state: State<'_, CliLaunchState>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
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

    tauri::Builder::default()
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
        .setup(|_app| {
            // Force creation of the data dir on first launch.
            let _ = data_dir::data_dir();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_data_dir,
            take_cli_launch_path,
            start_watching,
            stop_watching,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
