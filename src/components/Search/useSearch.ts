import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {
  buildPattern,
  clearHighlights,
  findMatches,
  highlightMatches,
} from './domSearch';
import { useFrontmatter } from '../DocumentView/FrontmatterContext';

export interface SearchFlags {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchState {
  /** Total number of matches found (0 when no input or invalid regex). */
  total: number;
  /** Zero-based index of the currently-focused match, or -1 when none. */
  currentIndex: number;
  /** True when the input is non-empty but produced 0 matches. UI uses
   *  this to colour the counter red. */
  isInvalid: boolean;
}

export interface UseSearchReturn extends SearchState {
  /** Current query string (caller-driven). */
  query: string;
  /** Toggle flags (case/word/regex). */
  flags: SearchFlags;
  /** Replace the query — triggers a debounced re-search. */
  setQuery: (next: string) => void;
  /** Replace one or more flag values — triggers an immediate re-search. */
  setFlag: <K extends keyof SearchFlags>(name: K, value: SearchFlags[K]) => void;
  /** Advance to next match. Wraps around. */
  next: () => void;
  /** Step to previous match. Wraps around. */
  previous: () => void;
  /** Clear ALL highlights (called by the SearchBar on Esc / close). */
  clear: () => void;
}

interface UseSearchOptions {
  /** Ref to the article element we walk. */
  articleRef: RefObject<HTMLElement | null>;
  /** Whether the search UI is currently open. When false the hook
   *  clears highlights but keeps the last query in memory (R8.11). */
  isOpen: boolean;
  /** PR-7: change this whenever the article content has been
   *  replaced (doc path change OR watcher reload). The hook resets
   *  its match list — the previously-wrapped `<mark>` elements are
   *  no longer in the live DOM after a content swap. The query +
   *  flag state are kept (R8.11 — search term remembered for the
   *  session). */
  versionKey: string;
}

/**
 * In-document search hook (R8.1-R8.11, PR-7).
 *
 * Lifecycle:
 *   - On open: re-run search with the remembered query (selecting
 *     all of it via the SearchBar's input ref).
 *   - On query / flag change: clear → walk → wrap → focus #0.
 *   - On close: clear highlights, keep `query` + `flags` in memory so
 *     the next open pre-fills. State is module-scope (no reload).
 *
 * Skip-subtree rules:
 *   - `[data-no-search]` — Mermaid (PR-3) + TOC (PR-7).
 *   - `.katex` / `.katex-display` — KaTeX (R8.9).
 *   - `[data-frontmatter-body]` ONLY when frontmatter is collapsed
 *     (R8.10). When the user has opened the disclosure, this selector
 *     drops out of the skip list.
 *
 * Debounce: 150ms for query changes. Flag toggles re-run immediately —
 * the user toggled deliberately and we don't want to feel sluggish.
 */
export function useSearch(opts: UseSearchOptions): UseSearchReturn {
  const { articleRef, isOpen, versionKey } = opts;
  const [query, setQueryState] = useState<string>('');
  const [flags, setFlags] = useState<SearchFlags>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [total, setTotal] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isInvalid, setIsInvalid] = useState(false);

  // Live list of wrapped `<mark>` elements. Kept in a ref because it
  // changes outside React's reconciliation (the DOM is the source of
  // truth) and we don't want to force a render on each wrap.
  const markListRef = useRef<HTMLElement[]>([]);
  // Debounce timer handle.
  const debounceRef = useRef<number | null>(null);
  // Snapshot of the previous effect-firing's deps so we can classify the
  // next change as "query-only" (debounced) vs "something else"
  // (immediate). See the run-effect below.
  const lastDepsRef = useRef<{
    query: string;
    flags: SearchFlags;
    frontmatterExpanded: boolean;
    versionKey: string;
    isOpen: boolean;
  } | null>(null);

  // The FrontmatterContext lives in DocumentView's subtree — the hook
  // is called from a child of DocumentView so we can read it directly.
  const frontmatter = useFrontmatter();
  const frontmatterExpanded = frontmatter.isExpanded;

  // ---- The actual search runner. ----
  const runSearch = useCallback(
    (text: string, currentFlags: SearchFlags, frontmatterIsExpanded: boolean) => {
      const root = articleRef.current;
      if (!root) {
        markListRef.current = [];
        setTotal(0);
        setCurrentIndex(-1);
        setIsInvalid(false);
        return;
      }

      // Always clear previous highlights first — even on an empty input
      // we want the DOM clean.
      clearHighlights(root);
      markListRef.current = [];

      if (text === '') {
        setTotal(0);
        setCurrentIndex(-1);
        setIsInvalid(false);
        return;
      }

      const pattern = buildPattern(text, currentFlags);
      if (!pattern) {
        // Invalid regex (or empty input we already filtered above) —
        // signal the counter to paint red.
        setTotal(0);
        setCurrentIndex(-1);
        setIsInvalid(true);
        return;
      }

      const skipSelectors = [
        '[data-no-search]',
        '.katex',
        '.katex-display',
      ];
      if (!frontmatterIsExpanded) {
        skipSelectors.push('[data-frontmatter-body]');
      }

      const matches = findMatches(root, pattern, { skipSelectors });
      const marks = highlightMatches(matches);
      markListRef.current = marks;

      if (marks.length === 0) {
        setTotal(0);
        setCurrentIndex(-1);
        setIsInvalid(true);
        return;
      }

      setTotal(marks.length);
      setIsInvalid(false);
      // Focus the first match so the user immediately sees the orange
      // highlight + scroll-to position.
      setCurrentIndex(0);
    },
    [articleRef],
  );

  // ---- Effect: re-run search. ----
  //
  // Two paths:
  //   1. QUERY change → 150ms debounce. Protects against per-keystroke
  //      re-walks while the user is typing (a 50-char paste becomes one
  //      search, not fifty).
  //   2. Anything ELSE (flag toggle, frontmatter expand, doc-version
  //      change, open transition) → run immediately. The user toggled
  //      a deliberate switch and expects an instant visible update.
  //
  // The split is implemented with a ref that records the LAST value of
  // each non-query dep so we can detect which class of change fired the
  // effect. Initial mount counts as "non-query" (and skips work when
  // query is empty anyway).
  useEffect(() => {
    if (!isOpen) {
      // Closed bar: nothing to (re-)run. The close-effect below clears.
      return;
    }
    const last = lastDepsRef.current;
    const queryOnlyChange =
      last !== null &&
      last.flags === flags &&
      last.frontmatterExpanded === frontmatterExpanded &&
      last.versionKey === versionKey &&
      last.isOpen === isOpen &&
      last.query !== query;
    lastDepsRef.current = { query, flags, frontmatterExpanded, versionKey, isOpen };

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (queryOnlyChange) {
      // Debounced path.
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        runSearch(query, flags, frontmatterExpanded);
      }, 150);
      return () => {
        if (debounceRef.current !== null) {
          window.clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
      };
    }

    // Immediate path: flag toggle / frontmatter change / doc swap / open.
    runSearch(query, flags, frontmatterExpanded);
    return undefined;
  }, [query, flags, runSearch, isOpen, frontmatterExpanded, versionKey]);

  // ---- Effect: re-paint the "current" mark when currentIndex moves. ----
  useEffect(() => {
    const marks = markListRef.current;
    for (let i = 0; i < marks.length; i++) {
      const isCurrent = i === currentIndex;
      // Toggle a data attribute the CSS keys off (`mark[data-search-current]`).
      if (isCurrent) marks[i].setAttribute('data-search-current', '');
      else marks[i].removeAttribute('data-search-current');
    }
    if (currentIndex < 0 || currentIndex >= marks.length) return;
    const target = marks[currentIndex];
    if (!target) return;
    // R8.4: scroll the current match to view-center.
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentIndex, total]);

  // ---- Effect: when the bar closes, clear highlights but keep query. ----
  useEffect(() => {
    if (isOpen) return;
    const root = articleRef.current;
    if (root) clearHighlights(root);
    markListRef.current = [];
    setTotal(0);
    setCurrentIndex(-1);
    setIsInvalid(false);
  }, [isOpen, articleRef]);

  // ---- Effect: clean up on unmount (e.g. DocumentView swap). ----
  useEffect(() => {
    return () => {
      const root = articleRef.current;
      if (root) clearHighlights(root);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [articleRef]);

  // ---- Public action callbacks. ----
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
  }, []);

  const setFlag = useCallback(
    <K extends keyof SearchFlags>(name: K, value: SearchFlags[K]) => {
      setFlags((prev) => ({ ...prev, [name]: value }));
    },
    [],
  );

  const next = useCallback(() => {
    setCurrentIndex((prev) => {
      const marks = markListRef.current;
      if (marks.length === 0) return -1;
      return (prev + 1 + marks.length) % marks.length;
    });
  }, []);

  const previous = useCallback(() => {
    setCurrentIndex((prev) => {
      const marks = markListRef.current;
      if (marks.length === 0) return -1;
      return (prev - 1 + marks.length) % marks.length;
    });
  }, []);

  const clear = useCallback(() => {
    const root = articleRef.current;
    if (root) clearHighlights(root);
    markListRef.current = [];
    setTotal(0);
    setCurrentIndex(-1);
    setIsInvalid(false);
  }, [articleRef]);

  return useMemo<UseSearchReturn>(
    () => ({
      query,
      flags,
      total,
      currentIndex,
      isInvalid,
      setQuery,
      setFlag,
      next,
      previous,
      clear,
    }),
    [query, flags, total, currentIndex, isInvalid, setQuery, setFlag, next, previous, clear],
  );
}
