use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{
    event::ModifyKind, recommended_watcher, EventKind, RecommendedWatcher, RecursiveMode,
    Watcher,
};
use tauri::{AppHandle, Emitter};

/// State managed by Tauri. Holds the active watcher (if any) plus the path
/// it is watching, so a swap can drop the old watcher cleanly before
/// starting a new one.
///
/// `notify` requires the watcher value to stay alive — drop it and the
/// background thread shuts down. We park it inside an `Arc<Mutex<...>>`
/// rather than a `Mutex<Option<...>>` directly so the swap path can clone
/// the Arc into the worker thread for the debounced-event timer without
/// fighting the borrow checker.
pub struct WatcherState {
    inner: Mutex<Option<ActiveWatcher>>,
}

struct ActiveWatcher {
    /// Path of the file we are notifying on (normalized via `canonicalize`).
    /// Kept around for diagnostics — never read directly because the
    /// handler closure already captures the canonical target.
    #[allow(dead_code)]
    target: PathBuf,
    /// Held only to keep the background thread alive. Dropping it stops
    /// watching.
    _watcher: RecommendedWatcher,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

impl Default for WatcherState {
    fn default() -> Self {
        Self::new()
    }
}

/// 200ms debounce — editors save in two stages (write tmp + atomic rename)
/// which produces multiple `notify` events for a single user-visible save.
/// The PRD's tech note pins this number; do not lower it without re-reading
/// the file-watcher section.
const DEBOUNCE_MS: u64 = 200;

/// Start watching `path` for modifications. If a watcher is already active,
/// it is stopped first.
///
/// Strategy:
///   * We can't reliably watch a single file across platforms because some
///     editors save by writing to a temp + renaming over the original, which
///     looks like "the watched file went away" to `notify`. We watch the
///     PARENT directory (non-recursive) and filter events to our target
///     basename, which works for all save patterns we care about.
///   * Events are debounced 200ms with a shared `Instant`. Each incoming
///     event bumps the deadline; a single worker thread sleeps until the
///     deadline expires, then emits ONE `file-changed` event to the
///     frontend. The frontend hook calls back into `loadDocument` and
///     re-renders.
pub fn start_watching(
    state: &WatcherState,
    app: &AppHandle,
    path: String,
) -> Result<(), String> {
    let target_path = PathBuf::from(&path);
    if !target_path.is_file() {
        return Err(format!("not a file: {}", path));
    }
    let parent = target_path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path))?
        .to_path_buf();

    // Canonicalize ONLY for the event-comparison side. Some editors emit
    // events with the symlink-resolved form; canonicalize the incoming
    // event paths and our target so they match even when one carries a
    // `\\?\` prefix or differs in drive-letter case.
    //
    // CRITICAL: we keep the ORIGINAL `path` (as received from the
    // frontend) for the emit payload. The frontend uses backslash-form
    // case-insensitive equality (`pathsEqual`) to match `file-changed`
    // payloads against its currentPath — if we emit the canonicalized
    // form (which on Windows includes a `\\?\` prefix), the equality
    // check silently drops every event and watcher auto-reload appears
    // broken.
    let target_canonical = std::fs::canonicalize(&target_path)
        .unwrap_or_else(|_| target_path.clone());
    let emit_payload = path.clone();

    let app_handle = app.clone();
    let deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let deadline_for_handler = Arc::clone(&deadline);
    let target_for_handler = target_canonical.clone();

    let mut watcher = recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(err) => {
                eprintln!("[file-watcher] event error: {err}");
                return;
            }
        };
        // We only care about modify/create/remove-then-recreate events.
        // Access events (e.g. `mtime` reads) are noise.
        let interesting = matches!(
            event.kind,
            EventKind::Modify(ModifyKind::Data(_))
                | EventKind::Modify(ModifyKind::Any)
                | EventKind::Modify(ModifyKind::Name(_))
                | EventKind::Create(_)
        );
        if !interesting {
            return;
        }

        // Filter to our specific target. Compare canonicalized forms so an
        // event for `c:\foo\bar.md` matches a target stored as
        // `C:\foo\bar.md` (Windows case-insensitive). `canonicalize`
        // requires the file to exist; during an atomic-rename window the
        // target may briefly not exist, so we fall back to a case-
        // insensitive Path-string compare.
        let matches_target = event.paths.iter().any(|p| {
            if let Ok(p_canon) = std::fs::canonicalize(p) {
                p_canon == target_for_handler
            } else {
                paths_equal_loose(p, &target_for_handler)
            }
        });
        if !matches_target {
            return;
        }

        // Bump the debounce deadline.
        let new_deadline = Instant::now() + Duration::from_millis(DEBOUNCE_MS);
        let mut guard = match deadline_for_handler.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(), // poisoned, take it anyway
        };
        let was_idle = guard.is_none();
        *guard = Some(new_deadline);
        drop(guard);

        // If a worker is already pending, it will pick up the new deadline
        // before it sleeps the next iteration. Only spawn a fresh worker
        // when the channel was idle.
        if was_idle {
            let deadline_for_worker = Arc::clone(&deadline_for_handler);
            let app_for_worker = app_handle.clone();
            let payload_for_worker = emit_payload.clone();
            thread::spawn(move || {
                loop {
                    // Snapshot the current deadline.
                    let now = Instant::now();
                    let until = {
                        let g = match deadline_for_worker.lock() {
                            Ok(g) => g,
                            Err(p) => p.into_inner(),
                        };
                        match *g {
                            Some(d) => d,
                            None => return, // nothing pending
                        }
                    };
                    if now < until {
                        thread::sleep(until - now);
                        continue; // re-check; the deadline may have been bumped
                    }
                    // Deadline has passed — take it and emit.
                    {
                        let mut g = match deadline_for_worker.lock() {
                            Ok(g) => g,
                            Err(p) => p.into_inner(),
                        };
                        *g = None;
                    }
                    // Emit the ORIGINAL path string the frontend gave us
                    // — see the comment above `emit_payload`.
                    if let Err(err) = app_for_worker.emit("file-changed", &payload_for_worker) {
                        eprintln!("[file-watcher] emit failed: {err}");
                    }
                    return;
                }
            });
        }
    })
    .map_err(|e| format!("failed to create watcher: {e}"))?;

    // Watch the parent directory (non-recursive). The handler filters down
    // to our specific target.
    watcher
        .watch(parent.as_path(), RecursiveMode::NonRecursive)
        .map_err(|e| format!("failed to watch {}: {e}", parent.display()))?;

    // Swap into state, dropping any previous watcher.
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    *guard = Some(ActiveWatcher {
        target: target_canonical,
        _watcher: watcher,
    });
    Ok(())
}

/// Stop the active watcher (if any). Idempotent.
pub fn stop_watching(state: &WatcherState) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    *guard = None; // drops ActiveWatcher → drops _watcher → thread exits
    Ok(())
}

/// Case-insensitive path equality fallback used when `canonicalize` fails
/// (e.g., the file briefly doesn't exist during an atomic rename).
fn paths_equal_loose(a: &Path, b: &Path) -> bool {
    let a_str = a.to_string_lossy().to_lowercase().replace('/', "\\");
    let b_str = b.to_string_lossy().to_lowercase().replace('/', "\\");
    a_str == b_str
}
