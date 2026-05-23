import { describe, it, expect } from 'vitest';
import type { Root, Element } from 'hast';

import { rehypeSourceLine, rehypeSourceLineApply, readSourceLine } from './rehypeSourceLine';

function el(tagName: string, line: number): Element {
  return {
    type: 'element',
    tagName,
    properties: {},
    children: [],
    position: {
      start: { line, column: 1, offset: 0 },
      end: { line, column: 1, offset: 0 },
    },
  };
}

/** Build a plugin's transformer and run it against a tree in place. The
 *  cast drops unified's `this: Processor` binding so we can invoke the
 *  factory standalone in a test. */
function run(plugin: unknown, tree: Root): void {
  const transform = (plugin as () => (t: Root) => void)();
  transform(tree);
}

describe('rehypeSourceLine (pre-Shiki pass)', () => {
  it('stamps every top-level element with its source line', () => {
    const tree: Root = { type: 'root', children: [el('h1', 1), el('p', 3), el('pre', 5)] };
    run(rehypeSourceLine, tree);
    expect((tree.children[0] as Element).properties?.['data-source-line']).toBe(1);
    expect((tree.children[1] as Element).properties?.['data-source-line']).toBe(3);
    expect((tree.children[2] as Element).properties?.['data-source-line']).toBe(5);
  });
});

describe('rehypeSourceLineApply (post-Shiki pass)', () => {
  it('re-stamps a code block whose <pre> Shiki replaced with a Root fragment', () => {
    const tree: Root = { type: 'root', children: [el('h1', 1), el('p', 3), el('pre', 5)] };
    // Pass 1 records line-by-index on the tree.
    run(rehypeSourceLine, tree);

    // Simulate Shiki: replace the <pre> at index 2 with a Root fragment
    // containing a fresh <pre> that has neither data-source-line nor
    // position (codeToHast output).
    const shikiPre: Element = { type: 'element', tagName: 'pre', properties: {}, children: [] };
    const fragment = { type: 'root', children: [shikiPre] } as unknown as Root['children'][number];
    tree.children[2] = fragment;

    // Pass 2 re-applies by index.
    run(rehypeSourceLineApply, tree);

    expect(shikiPre.properties?.['data-source-line']).toBe(5);
    // Untouched siblings keep their first-pass stamp.
    expect((tree.children[0] as Element).properties?.['data-source-line']).toBe(1);
  });

  it('does not overwrite an element that already carries a line (mermaid/tables)', () => {
    const tree: Root = { type: 'root', children: [el('table', 2)] };
    run(rehypeSourceLine, tree);
    // Pretend something set a different line; apply must not clobber it.
    (tree.children[0] as Element).properties!['data-source-line'] = 99;
    run(rehypeSourceLineApply, tree);
    expect((tree.children[0] as Element).properties?.['data-source-line']).toBe(99);
  });
});

describe('readSourceLine', () => {
  it('reads the kebab key', () => {
    expect(readSourceLine({ 'data-source-line': 12 })).toBe(12);
  });
  it('tolerates the camelCased spelling', () => {
    expect(readSourceLine({ dataSourceLine: 7 })).toBe(7);
  });
  it('returns undefined when absent or non-numeric', () => {
    expect(readSourceLine({})).toBeUndefined();
    expect(readSourceLine(undefined)).toBeUndefined();
    expect(readSourceLine({ 'data-source-line': 'nope' })).toBeUndefined();
  });
});
