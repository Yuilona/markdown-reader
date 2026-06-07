use std::path::PathBuf;
#[cfg(windows)]
use std::path::Path;

use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::Manager;

/// Resolve the data directory for this platform (does not create it).
///
/// - **Windows**: portable layout — `<install_dir>/data/`, next to the
///   executable (ADR-lite D5: no `AppData/Roaming`; uninstall is a folder
///   delete and the app can live on any drive).
/// - **macOS / Linux**: the OS-standard per-app data dir via Tauri's
///   `app_data_dir()` (macOS `~/Library/Application Support/<identifier>`;
///   Linux `$XDG_DATA_HOME` or `~/.local/share/<identifier>`). The portable
///   next-to-exe layout is impossible there — `.app` bundles are
///   read-only/signed and AppImage mounts read-only.
///
/// Degrades gracefully (R6 / #20 / #21): on failure both branches fall back
/// to a temp-dir subfolder instead of panicking.
#[cfg(windows)]
fn resolve(_app: &AppHandle) -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .map(|dir| dir.join("data"))
        .unwrap_or_else(|| std::env::temp_dir().join("markdown-reader-data"))
}

#[cfg(not(windows))]
fn resolve(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("markdown-reader-data"))
}

/// Resolve the data dir for this platform and ensure it exists. Called once
/// at startup (see `lib.rs` setup); the result is cached in managed state.
/// Creating the dir is best-effort — a failure logs a warning rather than
/// panicking, matching the pre-existing graceful-degradation contract.
pub fn resolve_and_create(app: &AppHandle) -> PathBuf {
    let data = resolve(app);

    if let Err(err) = std::fs::create_dir_all(&data) {
        eprintln!(
            "warning: failed to create data dir at {}: {}",
            data.display(),
            err
        );
    }

    data
}

/// Managed state holding the resolved data dir, so the `get_data_dir`
/// command (and any future consumer) reads the once-resolved path instead
/// of recomputing it on every call.
pub struct DataDir(pub PathBuf);
