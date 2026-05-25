import { describe, it, expect } from 'vitest';
import { parser } from '@lezer/markdown';

import { Math } from './mathMarkdown';

// Configure the base markdown parser with our math extension and collect the
// node names produced for a source string (the nested stex subtree is mounted
// by `wrap: parseMixed`, but we only assert on the math nodes we define).
const mdMath = parser.configure(Math);

function nodeNames(src: string): string[] {
  const names: string[] = [];
  mdMath.parse(src).iterate({ enter: (n) => void names.push(n.name) });
  return names;
}

describe('mathMarkdown — $ / $$ recognition', () => {
  it('marks a block $$ … $$ as BlockMath with markers', () => {
    const names = nodeNames('$$a+b$$\n');
    expect(names).toContain('BlockMath');
    expect(names).toContain('MathMark');
  });

  it('marks a multi-line $$ block', () => {
    const names = nodeNames('$$\n\\frac{a}{b}\n$$\n');
    expect(names).toContain('BlockMath');
  });

  it('marks inline $ … $ as InlineMath', () => {
    const names = nodeNames('see $x^2$ here\n');
    expect(names).toContain('InlineMath');
  });

  it('does NOT treat prose currency ($5 and $10) as inline math', () => {
    const names = nodeNames('it costs $5 and $10 today\n');
    expect(names).not.toContain('InlineMath');
  });

  it('does NOT open inline math when a space follows the opening $', () => {
    const names = nodeNames('a $ b $ c\n');
    expect(names).not.toContain('InlineMath');
  });

  it('places opening + closing markers so the content overlay is well-formed', () => {
    // A closed block has exactly two MathMark nodes ($$ open + $$ close); the
    // span between them is what `wrap: parseMixed` hands to the stex parser.
    const names = nodeNames('$$\\frac{1}{2}$$\n');
    expect(names).toContain('BlockMath');
    expect(names.filter((n) => n === 'MathMark')).toHaveLength(2);
  });
});
