/**
 * Pure DOM-walking helpers for the in-document search (R8.1-R8.11, PR-7).
 *
 * Split out from `useSearch.ts` so the walker / wrapper / unwrapper can
 * be reasoned about (and one day tested) without React's render cycle
 * in the way.
 *
 * Skip-subtree contract:
 *   The walker prunes any subtree whose root matches one of the
 *   selectors in `skipSelectors`. The Mermaid (R4.6) and KaTeX (R8.9)
 *   exclusions go through this list, as does the collapsed-frontmatter
 *   case (R8.10 — caller passes `[data-frontmatter-body]` when the
 *   FrontmatterContext reports `isExpanded === false`).
 *
 * Match data structure:
 *   `{ node, start, end }` records a slice of a single text node. After
 *   a match list is wrapped, each match becomes a `<mark>` element. The
 *   wrapping has to process matches per-node in REVERSE order so each
 *   split-and-wrap doesn't shift indexes of unprocessed matches in the
 *   same node.
 */

export interface Match {
  /** The text node containing this match. */
  node: Text;
  /** Inclusive start index inside `node.nodeValue`. */
  start: number;
  /** Exclusive end index inside `node.nodeValue`. */
  end: number;
}

export interface FindMatchesOptions {
  /** CSS selectors whose subtrees should be entirely skipped. */
  skipSelectors: string[];
}

/**
 * Walk all text nodes under `root` and return every match of `pattern`.
 *
 * Skipping is enforced at the TreeWalker filter level: when a candidate
 * text node's ancestor chain hits a `skipSelectors` element, the walker
 * rejects the node and never descends further. We use `FILTER_REJECT`
 * (not `FILTER_SKIP`) because rejecting prunes the whole subtree, which
 * is what we want for `<div data-no-search>...</div>` wrappers.
 *
 * Caveat: `pattern` MUST have the `g` flag set so `exec` advances. The
 * helper bumps `lastIndex` on zero-length matches to guarantee
 * termination.
 */
export function findMatches(
  root: HTMLElement,
  pattern: RegExp,
  opts: FindMatchesOptions,
): Match[] {
  const matches: Match[] = [];
  const skipSelectors = opts.skipSelectors;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Empty / whitespace-only text nodes can't match anything useful.
      const value = node.nodeValue;
      if (!value || value.length === 0) return NodeFilter.FILTER_REJECT;

      // Walk up ancestors looking for a skip-match. Stop at `root` —
      // we don't care about anything above the article.
      let el: HTMLElement | null = node.parentElement;
      while (el && el !== root) {
        // Existing `<mark data-search-match>` wrappers must not be
        // re-matched. If a previous search ran without cleanup (or if
        // the user adds the same query that's already wrapped), we
        // skip and let the caller's clear-first contract handle it.
        if (el.hasAttribute('data-search-match')) {
          return NodeFilter.FILTER_REJECT;
        }
        for (const sel of skipSelectors) {
          if (el.matches(sel)) return NodeFilter.FILTER_REJECT;
        }
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Ensure the pattern is in `g` mode so `exec` can produce all matches.
  // We reset `lastIndex` between text nodes — without this, a previously
  // failed match in one node could skip matches in the next.
  if (!pattern.global) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] findMatches: pattern must be global');
    return [];
  }

  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    const text = textNode.nodeValue ?? '';
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      const matchText = m[0];
      // Empty-match guard: advance past the zero-length match so we
      // don't spin forever on a pattern like `.*` against an empty
      // alternation.
      if (matchText.length === 0) {
        pattern.lastIndex++;
        continue;
      }
      matches.push({ node: textNode, start: m.index, end: m.index + matchText.length });
    }
  }

  return matches;
}

/**
 * Wrap each match in a `<mark>` element with `data-search-match` and a
 * sequential `data-search-index`. Returns the `<mark>` elements in the
 * same order as the input array so the caller can pick "current" by
 * index.
 *
 * Per-text-node reverse processing:
 *   When two matches `M1` (start 5, end 8) and `M2` (start 12, end 15)
 *   live in the same text node, wrapping `M1` first splits the node and
 *   invalidates `M2`'s indices. Processing in reverse (`M2` first,
 *   then `M1`) keeps each preceding offset stable.
 */
export function highlightMatches(matches: Match[]): HTMLElement[] {
  if (matches.length === 0) return [];

  // Group matches by their text node. Group preserves the order of
  // first appearance, which matches the walker's document order.
  const grouped = new Map<Text, Match[]>();
  for (const m of matches) {
    const list = grouped.get(m.node);
    if (list) list.push(m);
    else grouped.set(m.node, [m]);
  }

  // Map from a match object to its produced `<mark>` element so we can
  // emit the output array in INPUT order (not per-text-node order)
  // after all wrapping is done.
  const markFor = new Map<Match, HTMLElement>();

  for (const list of grouped.values()) {
    // Sort within each node ascending, then process the array in
    // reverse — splitting from the back keeps preceding offsets valid.
    const sorted = list.slice().sort((a, b) => a.start - b.start);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const match = sorted[i];
      // After previous reverse-iteration splits, the original textNode
      // may have been turned into the LEADING fragment of the original
      // text (everything before the next match's start). The match's
      // `start` / `end` are still valid relative to whatever segment
      // currently holds them, because we only split things AFTER the
      // current match's end on each iteration.
      const node = match.node;
      // `splitText` returns the node containing everything from `end`
      // onward; the original node keeps `[0..end)`. After that, splitText
      // again on the original at `start` gives us the `[start..end)`
      // segment as a fresh text node we can wrap.
      const value = node.nodeValue ?? '';
      // Guard against bad ranges (shouldn't happen — the walker
      // computed them — but DOM ops above could in theory shrink the
      // node if a sibling reduced it). Bail silently rather than throw.
      if (match.end > value.length) continue;
      const afterMatch = node.splitText(match.end);
      void afterMatch;
      const matchSegment = node.splitText(match.start);
      const mark = document.createElement('mark');
      mark.setAttribute('data-search-match', '');
      mark.appendChild(matchSegment.cloneNode(true));
      const parent = matchSegment.parentNode;
      if (!parent) continue;
      parent.replaceChild(mark, matchSegment);
      markFor.set(match, mark);
    }
  }

  // Stamp sequential indices in the input order — the caller treats this
  // as the canonical match-id sequence used for "current" tracking.
  const result: HTMLElement[] = [];
  for (let i = 0; i < matches.length; i++) {
    const mark = markFor.get(matches[i]);
    if (!mark) continue;
    mark.setAttribute('data-search-index', String(result.length));
    result.push(mark);
  }
  return result;
}

/**
 * Unwrap every `<mark data-search-match>` under `root` and restore the
 * underlying text. After unwrapping, `parent.normalize()` merges the
 * adjacent text nodes that the previous `splitText` call left behind so
 * the DOM is exactly as it was before the highlight pass — important
 * because the next search will run `findMatches` fresh and zero-length
 * text-node fragments would inflate the walker's work.
 */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll('mark[data-search-match]');
  // Track the parents we touched so we can `normalize()` them once
  // each at the end, instead of N times during the loop.
  const touched = new Set<Node>();
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    touched.add(parent);
  });
  for (const parent of touched) {
    // `normalize` merges adjacent text nodes. `<Element>.normalize()`
    // exists on every parent type we touch (Element, DocumentFragment).
    if ('normalize' in parent && typeof (parent as Element).normalize === 'function') {
      (parent as Element).normalize();
    }
  }
}

/**
 * Construct a RegExp from raw user input + toggle flags. Returns `null`
 * on an invalid regex (the SearchBar shows "0 / 0" in red in that case).
 *
 * Order of flag application:
 *   1. If `regex === false`, escape the input so it's matched literally.
 *   2. If `wholeWord === true`, wrap with `\b...\b`.
 *   3. Add `g` flag always; add `i` flag when `caseSensitive === false`.
 *
 * The escape function below is the standard MDN-recommended replacement:
 * everything in `\^$*+?.()|[]{}` is escaped with a leading `\`.
 */
export function buildPattern(
  input: string,
  flags: { caseSensitive: boolean; wholeWord: boolean; regex: boolean },
): RegExp | null {
  if (input === '') return null;
  let source = input;
  if (!flags.regex) {
    source = escapeRegex(source);
  }
  if (flags.wholeWord) {
    // \b is the standard regex word boundary; works for ASCII word
    // characters. CJK text doesn't have word boundaries in the regex
    // engine's sense, so for CJK queries the wholeWord toggle is a no-op
    // — which matches user expectation (CJK characters are "whole word"
    // by default).
    source = `\\b${source}\\b`;
  }
  const regexFlags = flags.caseSensitive ? 'g' : 'gi';
  try {
    return new RegExp(source, regexFlags);
  } catch {
    return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
