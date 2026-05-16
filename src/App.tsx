import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Titlebar } from './components/Titlebar/Titlebar';
import { EmptyState } from './components/EmptyState/EmptyState';
import { DocumentView } from './components/DocumentView/DocumentView';
import { LightboxProvider } from './components/Lightbox/LightboxContext';
import { ThemeProvider } from './components/ThemeProvider/ThemeProvider';
import { useShortcuts } from './hooks/useShortcuts';
import { useDragDrop } from './hooks/useDragDrop';
import { useFileWatcher } from './hooks/useFileWatcher';
import {
  registerSecondInstanceListener,
  takeCliLaunchPath,
} from './lib/singleInstance';
import { loadDocument, type LoadedDocument } from './lib/tauri';
import { cleanupStaleTemp } from './lib/recentFiles';
import { loadUserCss } from './lib/userCss';
import { LinkRouterContext, type LinkRouterContextValue } from './lib/linkRouter';
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type Settings,
} from './lib/settings';

const DROP_ERROR_MS = 3000;
const DROP_ERROR_TEXT = '无法打开：仅支持 .md / .markdown 文件';

/**
 * PR-6: outer App is a thin wrapper that mounts <ThemeProvider> so every
 * descendant (including Titlebar's theme toggle and useShortcuts's
 * Ctrl+T handler) can call useTheme(). The actual app body lives in
 * <AppContent> to keep the provider boundary clean.
 *
 * We also fire `loadUserCss()` here (not inside AppContent) so the
 * read-once user.css inject runs exactly once for the app lifetime,
 * regardless of any future remount of the body.
 */
export default function App() {
  useEffect(() => {
    void loadUserCss();
  }, []);

  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

function AppContent() {
  // PR-2: a single in-memory document. Multi-file/tabs is explicitly
  // out of scope (and probably forever) per PRD §"Out of Scope".
  const [doc, setDoc] = useState<LoadedDocument | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

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
  // once readSettings() resolves — same pattern ThemeProvider uses.
  const [tocVisible, setTocVisible] = useState<boolean>(DEFAULT_SETTINGS.showTocByDefault);
  const [searchOpen, setSearchOpen] = useState(false);
  // Cached settings snapshot so toggle writes preserve other fields
  // (theme, pageZoom) that App.tsx doesn't own.
  const persistedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  // Forwarded to SearchBar — lets the Ctrl+F handler re-focus and
  // select the input when the bar is already open.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Initial settings load → promote tocVisible to persisted value.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await readSettings();
      if (cancelled) return;
      persistedSettingsRef.current = settings;
      setTocVisible(settings.showTocByDefault);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // PR-7: Ctrl+\ handler. Toggles AND persists. We persist the same
  // way ThemeProvider does: round-trip the cached settings so we don't
  // clobber theme / pageZoom.
  const handleToggleToc = useCallback(() => {
    setTocVisible((prev) => {
      const next = !prev;
      const updated: Settings = {
        ...persistedSettingsRef.current,
        showTocByDefault: next,
      };
      persistedSettingsRef.current = updated;
      void writeSettings(updated).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[markdown-reader] failed to persist showTocByDefault:', err);
      });
      return next;
    });
  }, []);

  // Wire Ctrl+O / Ctrl+T / Ctrl+F / Ctrl+\. The shortcut returns a
  // LoadedDocument for Ctrl+O (recent already updated by openFileDialog
  // → loadDocument); we just promote it.
  useShortcuts({
    onOpenDocument: setDoc,
    onOpenSearch: handleOpenSearch,
    onToggleToc: handleToggleToc,
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

  // PR-7: close the SearchBar when there's no document — the bar is
  // useless without an article to walk. Reset on doc change too: a fresh
  // document means the previously-wrapped marks (which were in the
  // outgoing doc's tree) are gone.
  useEffect(() => {
    if (!doc) setSearchOpen(false);
  }, [doc]);

  const handleCloseSearch = useCallback(() => setSearchOpen(false), []);

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
