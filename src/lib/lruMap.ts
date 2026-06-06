/**
 * A `Map` with a bounded entry count and LRU (least-recently-used) eviction.
 *
 * - Reading via `get()` marks the entry most-recently-used (moved to the tail).
 * - Inserting via `set()` past `max` evicts the oldest (head) entries.
 *
 * Used to bound caches that would otherwise grow unbounded across a session:
 * the Shiki per-code-block highlight cache (cr-performance #1) and the rendered
 * Mermaid SVG cache (cr-performance #14). Extends the native `Map`, so it is a
 * drop-in for anything (incl. `@shikijs/rehype`'s `cache` option) expecting a
 * Map-like `get`/`set`/`has`/iteration surface.
 *
 * Requires ES2022 (the project's tsconfig target) where subclassing built-in
 * `Map` works correctly.
 */
export class LruMap<K, V> extends Map<K, V> {
  private readonly max: number;

  constructor(max: number) {
    super();
    // Guard against a nonsensical cap so we never evict on every insert.
    this.max = Math.max(1, Math.floor(max));
  }

  get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key) as V;
    // Re-insert to move this key to the most-recently-used (tail) position.
    super.delete(key);
    super.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    // Evict the oldest entries until we're within the cap. Map preserves
    // insertion order, so the first key is the least-recently-used.
    while (this.size > this.max) {
      const oldest = this.keys().next().value as K;
      super.delete(oldest);
    }
    return this;
  }
}
