mod data_dir;

use tauri::{Emitter, Manager};

/// Tauri command exposed to the frontend.
/// Returns the absolute path of the portable data directory as a string.
#[tauri::command]
fn get_data_dir() -> String {
    data_dir::data_dir().to_string_lossy().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance plugin: when a second copy is launched, forward its
        // argv to the running window via a "second-instance" event and bring
        // the window to the foreground. PR-5 will wire actual file open from
        // this event; PR-1 just emits.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("second-instance", args);
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            // Force creation of the data dir on first launch.
            let _ = data_dir::data_dir();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_data_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
