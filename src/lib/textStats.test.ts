import { describe, it, expect } from 'vitest';

import { textStats } from './textStats';

describe('textStats', () => {
  it('counts each CJK character as one word', () => {
    expect(textStats('这是一段中文正文。').words).toBe(8);
  });

  it('counts Latin words and numbers, ignoring markdown syntax', () => {
    // Hello / world / version / 1.4.7 / don't / panic / ok
    expect(textStats('## Hello *world*, version 1.4.7 — don\'t panic | ok').words).toBe(7);
  });

  it('handles mixed CJK + Latin text', () => {
    // 混排(2) English(1) text(1) 与(1) inline(1) code(1)
    expect(textStats('混排 English text、`inline code` 与').words).toBe(7);
  });

  it('estimates reading time, at least one minute for any content', () => {
    expect(textStats('').minutes).toBe(0);
    expect(textStats('hi').minutes).toBe(1);
    expect(textStats('字'.repeat(4000)).minutes).toBe(10);
    expect(textStats('word '.repeat(1000)).minutes).toBe(5);
  });
});
