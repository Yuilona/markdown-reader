import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Status bar context (R7.6, PR-8).
 *
 * Drives the bottom-of-window URL display. A single string of state —
 * `text` — holds whatever should be shown right now. The DocumentView
 * attaches a delegated `mouseover`/`mouseout` listener on the article
 * element and calls `setText(href)` on enter / `setText(null)` on leave.
 *
 * Keeping the state in a context (rather than App-local state passed
 * down via props) lets the StatusBar component live at the very bottom
 * of the `.app-root` layout while the producer lives deep inside
 * DocumentView — no prop drilling.
 *
 * Stable identity:
 *   `setText` is wrapped in useCallback so attaching it as a dependency
 *   of effects in DocumentView doesn't churn on every parent render.
 */

interface StatusBarContextValue {
  /** Current text to display in the status bar. null → empty (the bar
   *  still occupies its row so layout doesn't jump). */
  text: string | null;
  /** Set the bar text. Pass null to clear. */
  setText: (text: string | null) => void;
}

const StatusBarContext = createContext<StatusBarContextValue | null>(null);
export { StatusBarContext };

export function StatusBarProvider({ children }: { children: ReactNode }) {
  const [text, setTextState] = useState<string | null>(null);

  const setText = useCallback((next: string | null) => {
    // Compare before setting so a stream of mouseover events on the
    // same anchor's child spans doesn't churn React. (The delegated
    // listener walks up to the nearest anchor and may fire for each
    // child element under the same href.)
    setTextState((prev) => (prev === next ? prev : next));
  }, []);

  const value = useMemo<StatusBarContextValue>(
    () => ({ text, setText }),
    [text, setText],
  );

  return (
    <StatusBarContext.Provider value={value}>
      {children}
    </StatusBarContext.Provider>
  );
}

/**
 * Hook for reading + writing the status bar text.
 * Returns a safe no-op fallback when no provider is mounted so a unit
 * test that omits the provider doesn't crash — App.tsx always mounts
 * the provider in practice.
 */
export function useStatusBar(): StatusBarContextValue {
  const value = useContext(StatusBarContext);
  if (!value) {
    return NOOP;
  }
  return value;
}

const NOOP: StatusBarContextValue = {
  text: null,
  setText: () => undefined,
};
