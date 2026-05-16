import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
import { ConfirmProvider } from './components/ConfirmDialog/useConfirm';
import { EditModeProvider } from './components/EditModeProvider/EditModeProvider';
import { useEditMode } from './components/EditModeProvider/useEditMode';
import { EditorSkeleton } from './components/Editor/EditorSkeleton';
import { SplitView } from './components/SplitView/SplitView';
import { useShortcuts } from './hooks/useShortcuts';
import { useDragDrop } from './hooks/useDragDrop';
import { useFileWatcher } from './hooks/useFileWatcher';
import { useDirtyGuard } from './hooks/useDirtyGuard';
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
import * as logger from './lib/logger';

const DROP_ERROR_TEXT = '无法打开：仅支持 .md / .markdown 文件';

/**
 * v1.0 PR-A (R-EDIT-1.2): the CodeMirror editor is lazy-loaded so the
 * heavy CM6 chunk (~200 KB gzip) only ships when the user first enters
 * edit mode. The fallback `<EditorSkeleton>` paints briefly during the
 * first download; subsequent mode toggles use the cached chunk.
 *
 * The lazy() call has to live at module scope (not inside the
 * component) so React caches the imported module across renders.
 */
const CodeMirrorEditor = lazy(() => import('./components/Editor/CodeMirrorEditor'));

/**
 * PR-6: outer App is a thin wrapper that mounts <ThemeProvider> so every
 * descendant (including Titlebar's theme toggle and useShortcuts's
 * Ctrl+T handler) can call useTheme(). The actual app body lives in
 * <AppContent> to keep the provider boundary clean.
 *
 * Provider nesting (outer → inner):
 *   ThemeProvider
 *     PageZoomProvider           ← exposes usePageZoom() (R10.5, R13)
 *       ToastProvider            ← exposes useToast()
 *         ContextMenuProvider    ← exposes useContextMenu()
 *           StatusBarProvider    ← exposes useStatusBar()
 *             ConfirmProvider    ← v1.0 PR-A: exposes useConfirm()
 *                                  (3-button modal — for dirty guard +
 *                                  watcher conflict)
 *               AppContent
 *                 (wraps the body in EditModeProvider — see below for
 *                 why that lives inside AppContent and not here)
 *
 * The error boundary intentionally wraps ONLY the document tree. A
 * render crash inside DocumentView still leaves the Titlebar, theme
 * toggle, toast system, and reload button reachable.
 *
 * We also fire `loadUserCss()` here (not inside AppContent) so the
 * read-once user.css inject runs exactly once for the app lifetime,
 * regardless of any future remount of the body.
 */
export default function App() {
  useEffect(() => {
    void loadUserCss();
  }, []);

  useWindowStatePersistence();

  return (
    <ThemeProvider>
      <PageZoomProvider>
        <ToastProvider>
          <ContextMenuProvider>
            <StatusBarProvider>
              <ConfirmProvider>
                <AppContent />
              </ConfirmProvider>
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

  const [tocVisible, setTocVisible] = useState<boolean>(DEFAULT_SETTINGS.showTocByDefault);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Initial settings load → promote tocVisible to persisted value via
  // the shared settings store (PR-9 hotfix).
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

  const showError = useCallback(
    (message: string, details?: string) => {
      toast.show(message, { variant: 'error', details });
    },
    [toast],
  );

  const showDropError = useCallback(() => {
    showError(DROP_ERROR_TEXT);
  }, [showError]);

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

  /**
   * v1.0 PR-A: invoked by EditModeProvider after a successful save
   * (Ctrl+S OR silent-save-on-mode-flip). We mint a fresh
   * LoadedDocument with the same path + the just-written text so
   * `doc.text === bufferText` and the derived `dirty` bit becomes
   * false. The path is unchanged, so the scroll container stays
   * mounted and the file watcher continues to watch the same file.
   *
   * Why we don't re-read from disk: the just-written text is already
   * authoritative — re-reading would be a wasted round-trip AND would
   * race with our own watcher event (which fires for our own writes).
   */
  const handleDocTextSync = useCallback((text: string) => {
    setDoc((prev) => (prev ? { ...prev, text } : prev));
  }, []);

  // PR-7: Ctrl+F handler.
  const handleOpenSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return prev;
      }
      return true;
    });
  }, []);

  // PR-7: Ctrl+\ handler.
  const handleToggleToc = useCallback(() => {
    setTocVisible((prev) => {
      const next = !prev;
      void updateSettings({ showTocByDefault: next });
      return next;
    });
  }, []);

  // PR-9: Ctrl+W handler — drop back to EmptyState.
  const handleCloseDocument = useCallback(() => {
    setDoc(null);
  }, []);

  // PR-9: Ctrl+R / F5 handler — re-read the current file.
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

  // PR-5b: link router context.
  const linkRouterValue = useMemo<LinkRouterContextValue>(
    () => ({
      openDocument: (p) => {
        void setDocFromPath(p);
      },
      onError: showError,
    }),
    [setDocFromPath, showError],
  );

  useEffect(() => {
    if (!doc) setSearchOpen(false);
  }, [doc]);

  const handleCloseSearch = useCallback(() => setSearchOpen(false), []);

  const handleBoundaryReset = useCallback(() => {
    const path = doc?.path;
    setDoc(null);
    if (path) {
      void setDocFromPath(path);
    }
  }, [doc, setDocFromPath]);

  // v1.0 PR-A: EditModeProvider wraps the rest of AppContent. It
  // needs to be INSIDE ToastProvider + ConfirmProvider (so save +
  // dirty-guard work) and INSIDE LinkRouterContext (so the
  // useFileWatcher hook below it can read the edit-mode state).
  return (
    <LinkRouterContext.Provider value={linkRouterValue}>
      <EditModeProvider doc={doc} onDocTextSync={handleDocTextSync}>
        <AppBody
          doc={doc}
          isDragOver={isDragOver}
          tocVisible={tocVisible}
          searchOpen={searchOpen}
          searchInputRef={searchInputRef}
          handleOpenSearch={handleOpenSearch}
          handleToggleToc={handleToggleToc}
          handleCloseDocument={handleCloseDocument}
          handleReloadDocument={handleReloadDocument}
          handleCloseSearch={handleCloseSearch}
          handleBoundaryReset={handleBoundaryReset}
          setDoc={setDoc}
          setDocFromPath={setDocFromPath}
        />
      </EditModeProvider>
    </LinkRouterContext.Provider>
  );
}

interface AppBodyProps {
  doc: LoadedDocument | null;
  isDragOver: boolean;
  tocVisible: boolean;
  searchOpen: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  handleOpenSearch: () => void;
  handleToggleToc: () => void;
  handleCloseDocument: () => void;
  handleReloadDocument: () => void;
  handleCloseSearch: () => void;
  handleBoundaryReset: () => void;
  setDoc: React.Dispatch<React.SetStateAction<LoadedDocument | null>>;
  setDocFromPath: (path: string) => Promise<void>;
}

/**
 * v1.0 PR-A: the actual app body lives in a sub-component so we can
 * call `useEditMode()` and `useFileWatcher()` — both depend on
 * EditModeProvider being mounted, which AppContent installs as our
 * parent.
 *
 * Splitting AppContent / AppBody this way:
 *   - Keeps the provider tree linear and obvious.
 *   - Lets useFileWatcher pull from EditModeProvider via its own
 *     `useEditMode()` call (no prop drilling for the conflict
 *     dialog's mode/dirty state).
 *   - Lets the dirty-guard wrap Ctrl+W + onCloseRequested in ONE
 *     place where both the EditMode state and the close-handler
 *     callbacks are in scope.
 */
function AppBody(props: AppBodyProps) {
  const {
    doc,
    isDragOver,
    tocVisible,
    searchOpen,
    searchInputRef,
    handleOpenSearch,
    handleToggleToc,
    handleCloseDocument,
    handleReloadDocument,
    handleCloseSearch,
    handleBoundaryReset,
    setDoc,
    setDocFromPath,
  } = props;

  const { mode, bufferText, setBufferText, dirty, save, toggleMode } = useEditMode();

  // Dirty guard — used by Ctrl+W, Ctrl+R, and the window close handler.
  // Save callback closes over the EditModeProvider's save fn; the guard
  // shows the 3-button prompt when dirty.
  const guardedSave = useCallback(async () => {
    await save();
  }, [save]);
  const { guardedAction } = useDirtyGuard(dirty, guardedSave);

  // v1.0 PR-A wraps Ctrl+W with the dirty guard. The unwrapped close
  // is still the underlying action (drop the doc → EmptyState).
  const handleGuardedCloseDocument = useCallback(() => {
    void guardedAction(async () => {
      handleCloseDocument();
    });
  }, [guardedAction, handleCloseDocument]);

  // Ctrl+R: when dirty, ask before reloading (a reload swaps doc.text
  // out from under the editor, which EditModeProvider's reset effect
  // would happily overwrite). When clean, just reload.
  const handleGuardedReloadDocument = useCallback(() => {
    void guardedAction(async () => {
      handleReloadDocument();
    });
  }, [guardedAction, handleReloadDocument]);

  // v1.0 PR-A: Ctrl+E toggles edit mode through the provider.
  const handleToggleEditMode = useCallback(() => {
    void toggleMode();
  }, [toggleMode]);

  // v1.0 PR-A: Ctrl+S explicit save. Guard against "no doc" (the
  // EditModeProvider's save no-ops in that case, but skipping the
  // call avoids a meaningless toast attempt). Errors are surfaced
  // inside save() itself via toast — we just log here for telemetry.
  const handleSaveDocument = useCallback(() => {
    if (!doc) return;
    void save().catch((err) => {
      logger.warn('Ctrl+S save failed:', err);
    });
  }, [doc, save]);

  // Wire the global keyboard shortcuts.
  useShortcuts({
    onOpenDocument: setDoc,
    onOpenSearch: handleOpenSearch,
    onToggleToc: handleToggleToc,
    onCloseDocument: handleGuardedCloseDocument,
    onReloadDocument: handleGuardedReloadDocument,
    onToggleEditMode: handleToggleEditMode,
    onSaveDocument: handleSaveDocument,
  });

  // v1.0 PR-A: file watcher with conflict handling. The hook itself
  // reads useEditMode() to decide between silent-reload and the
  // conflict prompt — see useFileWatcher's R-EDIT-8 implementation.
  // Here we just pass the path + the silent-reload callback.
  const onWatcherReload = useCallback((reloaded: LoadedDocument) => {
    setDoc(reloaded);
  }, [setDoc]);
  useFileWatcher({
    currentPath: doc?.path ?? null,
    onReload: onWatcherReload,
  });

  // v1.0 PR-A: window-close request from the OS / titlebar ✕. Wrap
  // with the dirty guard so the user can't lose unsaved edits by
  // clicking the close button. Tauri's `onCloseRequested` event lets
  // us call `preventDefault()` to suppress the close — that's how
  // the cancel branch of the guard avoids actually closing.
  //
  // Wiring constraint: this effect must run AFTER the EditModeProvider
  // is mounted (so the guardedAction closes over the live `dirty`
  // bit). Since we're inside AppBody, that's already the case.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const win = getCurrentWindow();
        const un = await win.onCloseRequested(async (event) => {
          if (!dirty) return; // No guard needed — let the close proceed.
          event.preventDefault();
          // Now run the prompt. If the user picks discard / save +
          // succeed, re-issue the close. The `cancel` branch leaves
          // the window open (we already preventDefault'd above).
          void guardedAction(async () => {
            // We've already preventDefault'd the OS-driven close; to
            // actually close after a successful prompt resolution, call
            // `win.close()`. The dirty bit is now false (save case) or
            // the user accepted discard.
            try {
              await win.close();
            } catch (err) {
              logger.warn('window close after guard failed:', err);
            }
          });
        });
        if (cancelled) {
          un();
        } else {
          unlisten = un;
        }
      } catch (err) {
        logger.warn('onCloseRequested wiring failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [dirty, guardedAction]);

  // v1.0 PR-A (R-EDIT-2.4 / R-EDIT-9.7): TOC sidebar auto-hides while
  // in edit mode. The persisted visibility is left alone (this is a
  // transient hide, not a setting flip), so switching back to read
  // mode restores whatever the user had before.
  const effectiveTocVisible = mode === 'edit' ? false : tocVisible;

  // v1.0 PR-A: in edit mode, render a SplitView with the CM6 editor on
  // the left/top and DocumentView (preview) on the right/bottom. The
  // editor's onChange writes to bufferText via EditModeProvider; the
  // preview reads editText (which is bufferText after a 500ms
  // debounce — see DocumentView's useDebouncedValue).
  const showSplit = doc !== null && mode === 'edit';

  return (
    <div className="app-root">
      <Titlebar docPath={doc?.path ?? null} />
      <LightboxProvider>
        <main className="app-main">
          <ErrorBoundary
            onReset={handleBoundaryReset}
            resetKey={doc?.path ?? null}
          >
            {doc ? (
              showSplit ? (
                <SplitView
                  left={
                    <Suspense fallback={<EditorSkeleton />}>
                      <CodeMirrorEditor
                        value={bufferText}
                        onChange={setBufferText}
                      />
                    </Suspense>
                  }
                  right={
                    <DocumentView
                      doc={doc}
                      tocVisible={effectiveTocVisible}
                      onToggleToc={handleToggleToc}
                      searchOpen={searchOpen}
                      onCloseSearch={handleCloseSearch}
                      searchInputRef={searchInputRef}
                      editText={bufferText}
                    />
                  }
                />
              ) : (
                <DocumentView
                  doc={doc}
                  tocVisible={effectiveTocVisible}
                  onToggleToc={handleToggleToc}
                  searchOpen={searchOpen}
                  onCloseSearch={handleCloseSearch}
                  searchInputRef={searchInputRef}
                />
              )
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
      <StatusBar />
    </div>
  );
}

