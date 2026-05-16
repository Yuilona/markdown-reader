import { useCallback, useEffect, useMemo, useState } from 'react';
import { Titlebar } from './components/Titlebar/Titlebar';
import { EmptyState } from './components/EmptyState/EmptyState';
import { DocumentView } from './components/DocumentView/DocumentView';
import { LightboxProvider } from './components/Lightbox/LightboxContext';
import { useShortcuts } from './hooks/useShortcuts';
import { useDragDrop } from './hooks/useDragDrop';
import { useFileWatcher } from './hooks/useFileWatcher';
import {
  registerSecondInstanceListener,
  takeCliLaunchPath,
} from './lib/singleInstance';
import { loadDocument, type LoadedDocument } from './lib/tauri';
import { cleanupStaleTemp } from './lib/recentFiles';
import { LinkRouterContext, type LinkRouterContextValue } from './lib/linkRouter';

const DROP_ERROR_MS = 3000;
const DROP_ERROR_TEXT = '无法打开：仅支持 .md / .markdown 文件';

export default function App() {
  // PR-2: a single in-memory document. Multi-file/tabs is explicitly
  // out of scope (and probably forever) per PRD §"Out of Scope".
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const showError = useCallback((message: string) => {
    // Re-trigger by clearing first so a second consecutive invalid drop
    // re-runs the CSS animation from the start.
    setDropError(null);
    requestAnimationFrame(() => {
      setDropError(message);
    });
  }, []);

  const showDropError = useCallback(() => {
    showError(DROP_ERROR_TEXT);
  }, [showError]);

  /**
   * The single funnel that EVERY file-open path goes through:
   *   - Ctrl+O dialog (via useShortcuts)
   *   - Drag-drop (via useDragDrop)
   *   - Recent-list click (via EmptyState → RecentList)
   *   - Second-instance event (via registerSecondInstanceListener)
   *   - CLI argv (via takeCliLaunchPath on mount)
   *   - PR-5b: in-doc link to a local .md (via LinkRouterContext)
   *
   * loadDocument() itself handles read + recent.json update + path
   * normalization, so this wrapper is essentially "load then promote
   * to state, or show an error banner".
   */
  const setDocFromPath = useCallback(
    async (path: string): Promise<void> => {
      const loaded = await loadDocument(path);
      if (loaded) {
        setDoc(loaded);
      } else {
        showDropError();
      }
    },
    [showDropError],
  );

  // PR-5b: file-watcher reload swaps doc.text WITHOUT changing doc.path,
  // which means DocumentView keeps its scroll container mounted and the
  // user's scroll position survives the re-render naturally.
  const onWatcherReload = useCallback((reloaded: LoadedDocument) => {
    setDoc(reloaded);
  }, []);
  useFileWatcher({
    currentPath: doc?.path ?? null,
    onReload: onWatcherReload,
  });

  // Auto-dismiss the banner after DROP_ERROR_MS. PR-8 will replace this
  // with a real toast system.
  useEffect(() => {
    if (!dropError) return;
    const id = window.setTimeout(() => setDropError(null), DROP_ERROR_MS);
    return () => window.clearTimeout(id);
  }, [dropError]);

  // Wire Ctrl+O. The shortcut returns a LoadedDocument (recent already
  // updated by openFileDialog → loadDocument); we just promote it.
  useShortcuts({ onOpenDocument: setDoc });

  // Wire drag-drop at the webview level.
  useDragDrop({
    onValidDrop: setDocFromPath,
    onInvalidDrop: showDropError,
    onHoverChange: setIsDragOver,
  });

  // Register the second-instance + CLI-launch listeners + cleanup stale
  // .tmp persistence files from a previous run.
  useEffect(() => {
    void cleanupStaleTemp();

    const unlistenPromise = registerSecondInstanceListener({
      onValidPath: setDocFromPath,
      onInvalidPath: showDropError,
    });

    void takeCliLaunchPath().then((path) => {
      if (path) void setDocFromPath(path);
    });

    return () => {
      unlistenPromise.then((cleanup) => cleanup?.());
    };
  }, [setDocFromPath, showDropError]);

  // PR-5b: link router context. In-doc anchor `<a>` overrides pull this
  // to route local .md clicks back to `setDocFromPath` and to surface
  // shell.open failures through the same dropError banner.
  const linkRouterValue = useMemo<LinkRouterContextValue>(
    () => ({
      openDocument: (p) => {
        void setDocFromPath(p);
      },
      onError: showError,
    }),
    [setDocFromPath, showError],
  );

  // LightboxProvider wraps the main content so DocumentView's Mermaid
  // toolbar + image click can dispatch open(). LinkRouterContext wraps
  // it for the same reason on the `<a>` override.
  return (
    <div className="app-root">
      <Titlebar />
      <LinkRouterContext.Provider value={linkRouterValue}>
        <LightboxProvider>
          <main className="app-main">
            {dropError && <DropErrorBanner message={dropError} />}
            {doc ? (
              <DocumentView doc={doc} />
            ) : (
              <EmptyState
                onOpen={setDoc}
                onPickRecent={setDocFromPath}
                isDragOver={isDragOver}
              />
            )}
          </main>
        </LightboxProvider>
      </LinkRouterContext.Provider>
    </div>
  );
}

/**
 * Minimal inline error banner. Intentionally not a "toast system" —
 * PR-8 ships that (R12.5). For PR-5a/PR-5b we just want the user to see
 * "you dropped the wrong kind of file" / "couldn't open that link"
 * without a console-only failure.
 *
 * Lives at the top of `<main>` so it floats above both EmptyState and
 * DocumentView. CSS auto-fades; the parent setTimeout removes it.
 */
function DropErrorBanner({ message }: { message: string }) {
  return (
    <div className="dropErrorBanner" role="alert" aria-live="polite">
      {message}
    </div>
  );
}
