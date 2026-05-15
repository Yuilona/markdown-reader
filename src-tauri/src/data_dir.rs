use std::path::PathBuf;

/// Resolve the portable data directory: `<install_dir>/data/`.
///
/// Per ADR-lite D5 in the PRD, the app does NOT use the OS-default
/// `AppData/Roaming/` location. The directory lives next to the executable
/// so that uninstalling the install dir cleanly removes everything and the
/// user can put the app on any drive.
///
/// Creates the directory on first call if it does not exist.
pub fn data_dir() -> PathBuf {
    let exe_path = std::env::current_exe().expect("failed to read current_exe path");
    let exe_dir = exe_path
        .parent()
        .expect("current_exe path has no parent directory")
        .to_path_buf();
    let data = exe_dir.join("data");

    if let Err(err) = std::fs::create_dir_all(&data) {
        eprintln!(
            "warning: failed to create data dir at {}: {}",
            data.display(),
            err
        );
    }

    data
}
