import { describe, it, expect } from 'vitest';

import { backTarget, EMPTY_HISTORY, forwardTarget, moveTo, recordVisit, type NavHistory } from './navHistory';

function visit(...paths: string[]): NavHistory {
  return paths.reduce(recordVisit, EMPTY_HISTORY);
}

describe('navHistory', () => {
  it('has nowhere to go before anything is opened', () => {
    expect(backTarget(EMPTY_HISTORY, null)).toBeNull();
    expect(forwardTarget(EMPTY_HISTORY, null)).toBeNull();
  });

  it('goes back and forward through visited documents', () => {
    let h = visit('a.md', 'b.md', 'c.md');
    expect(backTarget(h, 'c.md')).toEqual({ index: 1, path: 'b.md' });
    expect(forwardTarget(h, 'c.md')).toBeNull();

    h = moveTo(h, backTarget(h, 'c.md')!);
    // The swap to b.md that follows must not truncate history.
    h = recordVisit(h, 'b.md');
    expect(h.entries).toEqual(['a.md', 'b.md', 'c.md']);
    expect(forwardTarget(h, 'b.md')).toEqual({ index: 2, path: 'c.md' });
    expect(backTarget(h, 'b.md')).toEqual({ index: 0, path: 'a.md' });
  });

  it('a new visit after going back drops the forward branch', () => {
    let h = visit('a.md', 'b.md', 'c.md');
    h = recordVisit(moveTo(h, { index: 0, path: 'a.md' }), 'a.md');
    h = recordVisit(h, 'd.md');
    expect(h.entries).toEqual(['a.md', 'd.md']);
    expect(forwardTarget(h, 'd.md')).toBeNull();
  });

  it('reloading or saving the current document is not a new entry', () => {
    const h = visit('a.md', 'a.md', 'a.md');
    expect(h).toEqual({ entries: ['a.md'], index: 0 });
  });

  it('Back after closing (or from an unnamed buffer) reopens the last document', () => {
    const h = visit('a.md', 'b.md');
    expect(backTarget(h, null)).toEqual({ index: 1, path: 'b.md' });
    expect(forwardTarget(h, null)).toBeNull();
  });

  it('caps the history length', () => {
    const h = visit(...Array.from({ length: 150 }, (_, i) => `${i}.md`));
    expect(h.entries.length).toBe(100);
    expect(h.entries[0]).toBe('50.md');
    expect(h.index).toBe(99);
  });
});
