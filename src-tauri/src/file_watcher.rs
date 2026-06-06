use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
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
/// background thread shuts down. We park it inside a `Mutex<Option<...>>`.
pub struct WatcherState {
    inner: Mutex<Option<ActiveWatcher>>,
}

struct ActiveWatcher {
    /// Path of the file we are notifying on (as received from the frontend).
    /// Kept for diagnostics — never read directly because the handler closure
    /// already captures the target basename it matches against.
    #[allow(dead_code)]
    target: PathBuf,
    /// Cancellation token for the debounce worker thread (R2 / #10). The
    /// notify handler spawns a detached worker that sleeps out the debounce
    /// window. Dropping `_watcher` stops the notify OS thread but CANNOT stop
    /// an already-sleeping worker; setting `cancel` makes that worker's final
    /// wake a no-op (it returns without emitting), so a stop/swap can't emit a
    /// stale `file-changed` for a path we no longer watch.
    cancel: Arc<AtomicBool>,
    /// Held only to keep the notify background thread alive. Dropping it stops
    /// watching at the OS level.
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
///   * Because the watch is scoped to the single parent directory,
///     case-insensitive **basename** equality is an exact match for our
///     target (no two files in one dir share a name) and is immune to the
///     `\\?\` verbatim prefix / 8.3 short-name / drive-letter-case skew that a
///     canonicalized full-path compare suffers during the atomic-rename
///     window (R1 / #6 / #11).
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

    // Match incoming events by case-insensitive basename within the watched
    // parent dir (see the strategy note above for why this is exact + robust).
    let target_name = target_path
        .file_name()
        .ok_or_else(|| format!("no file name for {}", path))?
        .to_string_lossy()
        .to_lowercase();

    // CRITICAL: we keep the ORIGINAL `path` (as received from the frontend)
    // for the emit payload. The frontend uses backslash-form case-insensitive
    // equality (`pathsEqual`) to match `file-changed` payloads against its
    // currentPath — emitting a canonicalized form (which on Windows includes a
    // `\\?\` prefix) would make the equality check silently drop every event
    // and watcher auto-reload would appear broken.
    let emit_payload = path.clone();

    let app_handle = app.clone();
    let deadline: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let deadline_for_handler = Arc::clone(&deadline);

    // Cancellation token: lets stop_watching / swap neutralize an in-flight
    // debounce worker so it can't emit for an unwatched path (R2 / #10).
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_handler = Arc::clone(&cancel);

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

        // Filter to our specific target by case-insensitive basename. The
        // watch is non-recursive on the parent dir, so any event whose file
        // name equals the target's file name IS our file — robust across the
        // atomic-rename window where a full-path canonicalize would fail.
        let matches_target = event.paths.iter().any(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().to_lowercase() == target_name)
                .unwrap_or(false)
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
            let cancel_for_worker = Arc::clone(&cancel_for_handler);
            thread::spawn(move || {
                loop {
                    // Bail immediately if this watcher was stopped/replaced.
                    if cancel_for_worker.load(Ordering::SeqCst) {
                        return;
                    }
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
                    // R2 (#10): if the watcher was stopped/replaced while we
                    // slept, do NOT emit — that would be a stale event for a
                    // path we no longer watch.
                    if cancel_for_worker.load(Ordering::SeqCst) {
                        return;
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

    // Swap into state, cancelling + dropping any previous watcher first.
    let mut guard = state.inner.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(old) = guard.as_ref() {
        old.cancel.store(true, Ordering::SeqCst);
    }
    *guard = Some(ActiveWatcher {
        target: target_path,
        cancel,
        _watcher: watcher,
    });
    Ok(())
}

/// Stop the active watcher (if any). Idempotent.
pub fn stop_watching(state: &WatcherState) -> Result<(), String> {
    let mut guard = state.inner.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(active) = guard.as_ref() {
        // Neutralize any in-flight debounce worker so it can't emit a stale
        // `file-changed` after we stop (R2 / #10).
        active.cancel.store(true, Ordering::SeqCst);
    }
    *guard = None; // drops ActiveWatcher → drops _watcher → notify OS thread exits
    Ok(())
}
