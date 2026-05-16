import { useEffect, useState } from 'react';
import { Titlebar } from './components/Titlebar/Titlebar';
import { EmptyState } from './components/EmptyState/EmptyState';
import { DocumentView } from './components/DocumentView/DocumentView';
import { LightboxProvider } from './components/Lightbox/LightboxContext';
import { useShortcuts } from './hooks/useShortcuts';
import { registerSecondInstanceListener } from './lib/singleInstance';
import type { LoadedDocument } from './lib/tauri';

export default function App() {
  // PR-2: a single in-memory document. Multi-file/tabs is explicitly
  // out of scope (and probably forever) per PRD §"Out of Scope".
  const [doc, setDoc] = useState<LoadedDocument | null>(null);

  useShortcuts({ onOpenDocument: setDoc });

  useEffect(() => {
    const cleanupPromise = registerSecondInstanceListener();
    return () => {
      cleanupPromise.then((cleanup) => cleanup?.());
    };
  }, []);

  // PR-4: LightboxProvider wraps the main content so that both the
  // Mermaid Fullscreen button (inside DocumentView) and the img click
  // override (also inside DocumentView) can call `useLightbox().open(...)`.
  // The provider mounts the portal-rendered <Lightbox> internally —
  // because it portals to document.body, it sits above the titlebar
  // (z-index 9999) regardless of where the provider lives in the tree.
  return (
    <div className="app-root">
      <Titlebar />
      <LightboxProvider>
        <main className="app-main">
          {doc ? <DocumentView doc={doc} /> : <EmptyState onOpen={setDoc} />}
        </main>
      </LightboxProvider>
    </div>
  );
}
