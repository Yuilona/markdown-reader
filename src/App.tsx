import { useEffect, useState } from 'react';
import { Titlebar } from './components/Titlebar/Titlebar';
import { EmptyState } from './components/EmptyState/EmptyState';
import { DocumentView } from './components/DocumentView/DocumentView';
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

  return (
    <div className="app-root">
      <Titlebar />
      <main className="app-main">
        {doc ? <DocumentView doc={doc} /> : <EmptyState onOpen={setDoc} />}
      </main>
    </div>
  );
}
