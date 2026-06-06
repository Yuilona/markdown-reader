import { describe, it, expect } from 'vitest';

import { LruMap } from './lruMap';

describe('LruMap (cr-performance #1/#14)', () => {
  it('returns undefined for a missing key', () => {
    const m = new LruMap<string, number>(2);
    expect(m.get('x')).toBeUndefined();
  });

  it('evicts the least-recently-used entry once past the cap', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3); // over cap → evict oldest ('a')
    expect(m.size).toBe(2);
    expect(m.get('a')).toBeUndefined();
    expect(m.get('b')).toBe(2);
    expect(m.get('c')).toBe(3);
  });

  it('get() marks an entry most-recently-used so it survives the next eviction', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    expect(m.get('a')).toBe(1); // bump 'a' to MRU → 'b' is now oldest
    m.set('c', 3); // evicts 'b', NOT 'a'
    expect(m.get('b')).toBeUndefined();
    expect(m.get('a')).toBe(1);
    expect(m.get('c')).toBe(3);
  });

  it('re-setting an existing key updates its value and refreshes recency', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    m.set('a', 10); // update 'a' → MRU → 'b' is oldest
    m.set('c', 3); // evicts 'b'
    expect(m.get('a')).toBe(10);
    expect(m.get('b')).toBeUndefined();
    expect(m.get('c')).toBe(3);
  });

  it('clamps a non-positive cap to 1 (never evicts on every insert via a 0 cap)', () => {
    const m = new LruMap<string, number>(0);
    m.set('a', 1);
    m.set('b', 2);
    expect(m.size).toBe(1);
    expect(m.get('b')).toBe(2);
  });

  it('still supports Map iteration / prefix scans (mermaidCache.clearCacheForTheme relies on this)', () => {
    const m = new LruMap<string, number>(10);
    m.set('light::x', 1);
    m.set('dark::y', 2);
    const lightKeys = Array.from(m.keys()).filter((k) => k.startsWith('light::'));
    expect(lightKeys).toEqual(['light::x']);
    expect(m.size).toBe(2);
  });
});
