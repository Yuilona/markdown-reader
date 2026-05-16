import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Titlebar } from './components/Titlebar/Titlebar';
import { EmptyState } from './components/EmptyState/EmptyState';
import { DocumentView } from './components/DocumentView/DocumentView';
import { LightboxProvider } from './components/Lightbox/LightboxContext';
import { ThemeProvider } from './components/ThemeProvider/ThemeProvider';
import { PageZoomProvider } from './components/PageZoom/PageZoomProvider';
import { ToastProvider } from './components/Toast/ToastProvider';
import { useToast } from './components/Toast/useToast';
import { ContextMenuProvider } from './components/ContextMenu/ContextMenuContext';
import { StatusBarProvider } from './components/StatusBar/StatusBarContext';
import { StatusBar } from './components/StatusBar/StatusBar';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { useShortcuts } from './hooks/useShortcuts';
import { useDragDrop } from './hooks/useDragDrop';
import { useFileWatcher } from './hooks/useFileWatcher';
import { usePrintMode } from './hooks/usePrintMode';
import { useWindowStatePersistence } from './hooks/useWindowStatePersistence';
import {
  registerSecondInstanceListener,
  takeCliLaunchPath,
} from './lib/singleInstance';
import { loadDocument, type LoadedDocument } from './lib/tauri';
import { cleanupStaleTemp } from './lib/recentFiles';
import { loadUserCss } from './lib/userCss';
import { LinkRouterContext, type LinkRouterContextValue } from './lib/linkRouter';
import { DEFAULT_SETTINGS } from './lib/settings';
import { getSettings, updateSettings } from './lib/settingsStore';

const DROP_ERROR_TEXT = '无法打开：仅支持 .md / .markdown 文件';

/**
 * PR-6: outer App is a thin wrapper that mounts <ThemeProvider> so every
 * descendant (including Titlebar's theme toggle and useShortcuts's
 * Ctrl+T handler) can call useTheme(). The actual app body lives in
 * <AppContent> to keep the provider boundary clean.
 *
 * PR-9 provider nesting (outer → inner):
 *   ThemeProvider
 *     PageZoomProvider           ← exposes usePageZoom() (R10.5, R13)
 *       ToastProvider            ← exposes useToast()
 *         ContextMenuProvider    ← exposes useContextMenu()
 *           StatusBarProvider    ← exposes useStatusBar()
 *             AppContent
 *               Titlebar         (OUTSIDE the error boundary so the
 *                                 user can always close the window)
 *               LightboxProvider
 *                 LinkRouterProvider
 *                   main
 *                     ErrorBoundary
 *                       DocumentView / EmptyState
 *               StatusBar        (mounted after main so it sits at the
 *                                 bottom of `.app-root`)
 *
 * The error boundary intentionally wraps ONLY the document tree. A
 * render crash inside DocumentView still leaves the Titlebar, theme
 * toggle, toast system, and reload button reachable.
 *
 * We also fire `loadUserCss()` here (not inside AppContent) so the
 * read-once user.css inject runs exactly once for the app lifetime,
 * regardless of any future remount of the body.
 *
 * PageZoomProvider sits between ThemeProvider and ToastProvider because
 * (a) useShortcuts (mounted inside AppContent) needs both providers in
 * scope, and (b) page zoom is a "chrome-level" concern alongside theme
 * — both are persisted in settings.json and applied to the root DOM, so
 * grouping them at the top of the provider tree keeps the persistence
 * round-trip pattern symmetric.
 */
export default function App() {
  useEffect(() => {
    void loadUserCss();
  }, []);

  // PR-9 hotfix: window position / size / maximized are restored on
  // mount and re-saved (debounced) on every resize/move/close (R2.8,
  // R10.1). Lives at the top App so it survives any AppContent remount
  // (e.g. ErrorBoundary reset) and runs exactly once per process.
  useWindowStatePersistence();

  return (
    <ThemeProvider>
      <PageZoomProvider>
        <ToastProvider>
          <ContextMenuProvider>
            <StatusBarProvider>
              <AppContent />
            </StatusBarProvider>
          </ContextMenuProvider>
        </ToastProvider>
      </PageZoomProvider>
    </ThemeProvider>
  );
}

function AppContent() {
  // PR-8: pull the toast system once. All error-display call sites
  // (drop error, link router failure, file read failure) route through
  // toast.show now instead of the old DropErrorBanner.
  const toast = useToast();
  // PR-8: register the beforeprint/afterprint body-class toggle so the
  // @media print rules in styles/print.css have a state hook to gate on.
  usePrintMode();
  // PR-2: a single in-memory document. Multi-file/tabs is explicitly
  // out of scope (and probably forever) per PRD §"Out of Scope".
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // ---- PR-7: TOC visibility + SearchBar visibility. ----
  //
  // Both pieces of UI are document-scoped (they only render inside
  // DocumentView), but the keyboard shortcuts that toggle them live in
  // `useShortcuts` at the App level. Lifting the state here lets the
  // shortcut callbacks flip it while DocumentView still reads + renders
  // the actual components.
  //
  // TOC default comes from settings.showTocByDefault (R10.2). We start
  // with the DEFAULT_SETTINGS value, then promote to the persisted one
  // once the shared settings store resolves — same pattern
  // ThemeProvider / PageZoomProvider use.
  const [tocVisible, setTocVisible] = useState<boolean>(DEFAULT_SETTINGS.showTocByDefault);
  const [searchOpen, setSearchOpen] = useState(false);
  // Forwarded to SearchBar — lets the Ctrl+F handler re-focus and
  // select the input when the bar is already open.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Initial settings load → promote tocVisible to persisted value via
  // the shared settings store (PR-9 hotfix). No per-component snapshot
  // ref — the store guarantees write-merges across providers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await getSettings();
      if (cancelled) return;
      setTocVisible(settings.showTocByDefault);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // PR-8: showError replaces the PR-5a inline-banner state. Callers
  // hand us a one-line message and we route through toast.show with
  // variant 'error'. Errors are sticky by default — the user dismisses
  // them via the toast's ✕ button.
  const showError = useCallback(
    (message: string, details?: string) => {
      toast.show(message, { variant: 'error', details });
    },
    [toast],
  );

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
   *   - PR-8: ErrorBoundary reset (re-load the current doc.path)
   *
   * loadDocument() itself handles read + recent.json update + path
   * normalization, so this wrapper is essentially "load then promote
   * to state, or show an error toast".
   */
  const setDocFromPath = useCallback(
    async (path: string): Promise<void> => {
      const loaded = await loadDocument(path);
      if (loaded) {
        setDoc(loaded);
      } else {
        showError('无法打开文件');
      }
    },
    [showError],
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

  // PR-7: Ctrl+F handler. When the bar is already open, re-focus +
  // select the input so the user can re-type to replace their previous
  // query immediately.
  const handleOpenSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        // Already open — re-focus + select.
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return prev;
      }
      return true;
    });
  }, []);

  // PR-7: Ctrl+\ handler. Toggles AND persists.
  // PR-9 hotfix: persistence goes through the shared `settingsStore`,
  // which merges into the live cache and serializes the atomic write so
  // a concurrent ThemeProvider / PageZoomProvider write can't clobber
  // showTocByDefault (and we can't clobber theirs).
  const handleToggleToc = useCallback(() => {
    setTocVisible((prev) => {
      const next = !prev;
      void updateSettings({ showTocByDefault: next });
      return next;
    });
  }, []);

  // PR-9: Ctrl+W handler — drop back to EmptyState. setDoc(null) on an
  // already-null state is a React no-op (referential equality skips the
  // re-render), so we don't need an "is anything open?" guard.
  const handleCloseDocument = useCallback(() => {
    setDoc(null);
  }, []);

  // PR-9: Ctrl+R / F5 handler — re-read the current file via the same
  // path the file-watcher uses (skipRecent: true so a manual reload
  // doesn't bump the recent-list). DocumentView keeps its scroll
  // container mounted because we only swap doc.text (path is unchanged),
  // which means useScrollMemory's restore path doesn't re-run and the
  // current scroll position survives the reload naturally — same
  // semantics as the file-watcher auto-reload (R2.6).
  const handleReloadDocument = useCallback(() => {
    const path = doc?.path;
    if (!path) return;
    void (async () => {
      const reloaded = await loadDocument(path, { skipRecent: true });
      if (reloaded) {
        setDoc(reloaded);
      } else {
        showError('重新加载失败');
      }
    })();
  }, [doc, showError]);

  // Wire Ctrl+O / Ctrl+T / Ctrl+F / Ctrl+\ / Ctrl+P / Ctrl+W / Ctrl+Q /
  // Ctrl+R / F5 / Ctrl+= / Ctrl+- / Ctrl+0 / F11. The shortcut returns
  // a LoadedDocument for Ctrl+O (recent already updated by
  // openFileDialog → loadDocument); we just promote it.
  useShortcuts({
    onOpenDocument: setDoc,
    onOpenSearch: handleOpenSearch,
    onToggleToc: handleToggleToc,
    onCloseDocument: handleCloseDocument,
    onReloadDocument: handleReloadDocument,
  });

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
  // shell.open failures through the toast system (PR-8 replaces the
  // PR-5a banner with toast.show under the same `showError` API).
  const linkRouterValue = useMemo<LinkRouterContextValue>(
    () => ({
      openDocument: (p) => {
        void setDocFromPath(p);
      },
      onError: showError,
    }),
    [setDocFromPath, showError],
  );

  // PR-7: close the SearchBar when there's no document — the bar is
  // useless without an article to walk. Reset on doc change too: a fresh
  // document means the previously-wrapped marks (which were in the
  // outgoing doc's tree) are gone.
  useEffect(() => {
    if (!doc) setSearchOpen(false);
  }, [doc]);

  const handleCloseSearch = useCallback(() => setSearchOpen(false), []);

  // PR-8 ErrorBoundary reset:
  //   When the user clicks "重新加载" in the fallback UI, we clear the
  //   current doc and re-load from the same path. Two-phase reset:
  //     1. setDoc(null) so the boundary sees a different `resetKey` and
  //        clears its error state.
  //     2. void setDocFromPath(path) re-fetches the file. If the file
  //        itself is what crashed render (e.g. a Mermaid block triggered
  //        a deep mermaid bug), the user can fall back to ✕-closing the
  //        toast and dragging in a different file.
  const handleBoundaryReset = useCallback(() => {
    const path = doc?.path;
    setDoc(null);
    if (path) {
      void setDocFromPath(path);
    }
  }, [doc, setDocFromPath]);

  // LightboxProvider wraps the main content so DocumentView's Mermaid
  // toolbar + image click can dispatch open(). LinkRouterContext wraps
  // it for the same reason on the `<a>` override.
  return (
    <div className="app-root">
      <Titlebar />
      <LinkRouterContext.Provider value={linkRouterValue}>
        <LightboxProvider>
          <main className="app-main">
            <ErrorBoundary
              onReset={handleBoundaryReset}
              resetKey={doc?.path ?? null}
            >
              {doc ? (
                <DocumentView
                  doc={doc}
                  tocVisible={tocVisible}
                  onToggleToc={handleToggleToc}
                  searchOpen={searchOpen}
                  onCloseSearch={handleCloseSearch}
                  searchInputRef={searchInputRef}
                />
              ) : (
                <EmptyState
                  onOpen={setDoc}
                  onPickRecent={setDocFromPath}
                  isDragOver={isDragOver}
                />
              )}
            </ErrorBoundary>
          </main>
        </LightboxProvider>
      </LinkRouterContext.Provider>
      <StatusBar />
    </div>
  );
}
