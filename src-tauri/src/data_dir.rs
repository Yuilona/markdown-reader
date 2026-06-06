use std::path::{Path, PathBuf};

/// Resolve the portable data directory: `<install_dir>/data/`.
///
/// Per ADR-lite D5 in the PRD, the app does NOT use the OS-default
/// `AppData/Roaming/` location. The directory lives next to the executable
/// so that uninstalling the install dir cleanly removes everything and the
/// user can put the app on any drive.
///
/// Degrades gracefully (R6 / #20 / #21): if `current_exe()` is unavailable
/// (rare), fall back to a temp-dir subfolder instead of panicking. Creates the
/// directory on first call if it does not exist.
pub fn data_dir() -> PathBuf {
    let data = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .map(|dir| dir.join("data"))
        .unwrap_or_else(|| std::env::temp_dir().join("markdown-reader-data"));

    if let Err(err) = std::fs::create_dir_all(&data) {
        eprintln!(
            "warning: failed to create data dir at {}: {}",
            data.display(),
            err
        );
    }

    data
}
