// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

import { buildPattern, findMatches, MAX_MATCHES } from './domSearch';

/**
 * findMatches match-cap + buildPattern guard tests (cr-performance #16/#13).
 *
 * Runs under jsdom (opted in via the docblock above) so the TreeWalker /
 * DOM APIs the walker relies on are present.
 */
describe('findMatches match cap (cr-performance #16)', () => {
  const SKIP = { skipSelectors: [] as string[] };

  function rootWith(text: string): HTMLElement {
    const el = document.createElement('div');
    el.textContent = text;
    return el;
  }

  it('returns all matches and truncated=false when under the cap', () => {
    const root = rootWith('a a a a a');
    const { matches, truncated } = findMatches(root, /a/g, SKIP);
    expect(matches).toHaveLength(5);
    expect(truncated).toBe(false);
  });

  it('caps collection at MAX_MATCHES and flags truncated=true', () => {
    // One node with (MAX_MATCHES + 100) single-char hits.
    const root = rootWith('x'.repeat(MAX_MATCHES + 100));
    const { matches, truncated } = findMatches(root, /x/g, SKIP);
    expect(matches).toHaveLength(MAX_MATCHES);
    expect(truncated).toBe(true);
  });

  it('rejects a non-global pattern with empty matches', () => {
    const root = rootWith('aaa');
    const { matches, truncated } = findMatches(root, /a/, SKIP);
    expect(matches).toHaveLength(0);
    expect(truncated).toBe(false);
  });
});

describe('buildPattern ReDoS guard (cr-performance #13)', () => {
  const FLAGS = { caseSensitive: false, wholeWord: false, regex: true };

  it('builds a normal regex pattern', () => {
    const re = buildPattern('foo.*bar', FLAGS);
    expect(re).toBeInstanceOf(RegExp);
  });

  it('rejects an over-long regex pattern (returns null)', () => {
    const huge = 'a'.repeat(1001);
    expect(buildPattern(huge, FLAGS)).toBeNull();
  });

  it('does NOT length-cap literal (non-regex) queries', () => {
    const huge = 'a'.repeat(5000);
    const re = buildPattern(huge, { ...FLAGS, regex: false });
    expect(re).toBeInstanceOf(RegExp);
  });

  it('returns null for an invalid regex', () => {
    expect(buildPattern('(unbalanced', FLAGS)).toBeNull();
  });
});
