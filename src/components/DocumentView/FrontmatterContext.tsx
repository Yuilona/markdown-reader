import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Frontmatter open-state context (PR-7).
 *
 * Why this exists:
 *   R3.5 hides the YAML frontmatter behind a disclosure widget; R8.10
 *   says the SearchBar must include frontmatter text in matches ONLY when
 *   the user has expanded it. Native `<details>` keeps its `open` state
 *   internal to the DOM element, so the SearchBar can't read it without
 *   either querying the DOM (brittle) or coupling to the Frontmatter
 *   component (also brittle). Lifting the state into context resolves
 *   both: Frontmatter reads/writes through the hook, the SearchBar
 *   reads the same state to gate its skip-selector logic.
 *
 * Default: not expanded. The Frontmatter widget itself starts collapsed
 * (R3.5), so the initial value matches what the user sees.
 *
 * The provider is mounted by `DocumentView` around the article. When no
 * provider is present (e.g. a future component renders Frontmatter
 * standalone), `useFrontmatter()` falls back to a no-op pair so the
 * widget still works on its own.
 */

export interface FrontmatterContextValue {
  /** Is the frontmatter disclosure currently open? */
  isExpanded: boolean;
  /** Set the open state. Frontmatter calls this on `<summary>` click. */
  setExpanded: (next: boolean) => void;
}

const FrontmatterContext = createContext<FrontmatterContextValue | null>(null);

/**
 * Read the current frontmatter open-state. When called outside a
 * provider, returns a safe stub (`isExpanded: false`, no-op setter)
 * so component standalone rendering doesn't blow up — the SearchBar
 * already lives inside the DocumentView's provider, so the production
 * path always sees the live value.
 */
export function useFrontmatter(): FrontmatterContextValue {
  const value = useContext(FrontmatterContext);
  if (!value) {
    return { isExpanded: false, setExpanded: () => {} };
  }
  return value;
}

interface FrontmatterProviderProps {
  children: ReactNode;
  /** Reset the open state to collapsed whenever this key changes.
   *  DocumentView passes `doc.path` so navigating to a different file
   *  resets the disclosure to the default (R3.5: hidden by default).
   *  Watcher-fired reloads (same path, new text) do NOT trigger this
   *  reset — the user's prior expand choice is preserved across the
   *  silent reload. */
  resetKey?: string;
}

export function FrontmatterProvider({ children, resetKey }: FrontmatterProviderProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Re-collapse on resetKey change. Skips the initial mount because
  // useState already initialized to false.
  useEffect(() => {
    setIsExpanded(false);
  }, [resetKey]);

  const setExpanded = useCallback((next: boolean) => {
    setIsExpanded(next);
  }, []);

  const value = useMemo<FrontmatterContextValue>(
    () => ({ isExpanded, setExpanded }),
    [isExpanded, setExpanded],
  );

  return (
    <FrontmatterContext.Provider value={value}>
      {children}
    </FrontmatterContext.Provider>
  );
}
