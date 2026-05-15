import { useEffect } from 'react';
import { Titlebar } from './components/Titlebar/Titlebar';
import { EmptyState } from './components/EmptyState/EmptyState';
import { useShortcuts } from './hooks/useShortcuts';
import { registerSecondInstanceListener } from './lib/singleInstance';

export default function App() {
  useShortcuts();

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
        <EmptyState />
      </main>
    </div>
  );
}
