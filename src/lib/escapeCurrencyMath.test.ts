import { describe, it, expect } from 'vitest';

import { escapeCurrencyMath } from './escapeCurrencyMath';

describe('escapeCurrencyMath', () => {
  describe('escapes currency so remark-math leaves it as text', () => {
    it('escapes a single $N.NN amount', () => {
      expect(escapeCurrencyMath('cost ($0.94/case)')).toBe('cost (\\$0.94/case)');
    });

    it('escapes BOTH amounts in a currency pair (the GoS.md overflow case)', () => {
      const input = 'expense ($0.10 vs. $0.94, ~ 8x cost reduction)';
      expect(escapeCurrencyMath(input)).toBe('expense (\\$0.10 vs. \\$0.94, ~ 8x cost reduction)');
    });

    it('escapes one-decimal amounts like $29.2', () => {
      expect(escapeCurrencyMath("'$29.2'")).toBe("'\\$29.2'");
    });

    it('escapes thousands-grouped amounts like $1,000.00', () => {
      expect(escapeCurrencyMath('budget $1,000.00 total')).toBe('budget \\$1,000.00 total');
    });

    it('escapes every amount across a real prose paragraph', () => {
      const input =
        'Multi/FoT incurs the highest cost ($0.73/case), whereas GoS achieves it at ($0.12).';
      expect(escapeCurrencyMath(input)).toBe(
        'Multi/FoT incurs the highest cost (\\$0.73/case), whereas GoS achieves it at (\\$0.12).',
      );
    });
  });

  describe('does NOT touch real inline math', () => {
    it('leaves digit-leading math `$0 = b_{0} < ...$` intact', () => {
      const input = 'return-to- $0 = b _ { 0 } < b _ { 1 } < \\dots < b _ { K } = T$ switch';
      expect(escapeCurrencyMath(input)).toBe(input);
    });

    it('leaves `$1 . 0$` (spaced decimal) intact', () => {
      const input = 'learning rate $1 . 0 \\times 10 ^ { -6 }$ for';
      expect(escapeCurrencyMath(input)).toBe(input);
    });

    it('leaves symbol math `$h_t^*$` intact', () => {
      const input = 'the focus $h _ { t } ^ { * }$ enforces';
      expect(escapeCurrencyMath(input)).toBe(input);
    });

    it('leaves a display-math block `$$...$$` intact even if it contains digits/dots', () => {
      const input = '$$\nP(v) = 0.5 \\cdot x\n$$';
      expect(escapeCurrencyMath(input)).toBe(input);
    });
  });

  describe('skips code regions', () => {
    it('leaves currency inside a fenced code block intact (HiPER.md ```txt case)', () => {
      const input = "```txt\n'Price: $16.05 to $40.98'\n```";
      expect(escapeCurrencyMath(input)).toBe(input);
    });

    it('leaves currency inside a ~~~ fence intact', () => {
      const input = '~~~\nprice = $9.99\n~~~';
      expect(escapeCurrencyMath(input)).toBe(input);
    });

    it('leaves currency inside an inline code span intact', () => {
      const input = 'the value `$9.99` is code';
      expect(escapeCurrencyMath(input)).toBe(input);
    });

    it('escapes prose currency but not the adjacent code-span currency', () => {
      const input = 'pay $5.00 not `$9.99`';
      expect(escapeCurrencyMath(input)).toBe('pay \\$5.00 not `$9.99`');
    });
  });

  describe('idempotent / already-escaped', () => {
    it('does not double-escape an already-escaped \\$amount', () => {
      const input = 'cost \\$0.94 here';
      expect(escapeCurrencyMath(input)).toBe(input);
    });

    it('running twice equals running once', () => {
      const input = 'a ($0.94) b ($0.10 vs. $0.94) `$1.23` c';
      const once = escapeCurrencyMath(input);
      expect(escapeCurrencyMath(once)).toBe(once);
    });
  });

  describe('line-count safety (source-line stamps depend on it)', () => {
    it('never changes the number of lines', () => {
      const input =
        'l1 ($0.94)\nl2 $0 = b_0$\n```\n$5.00 code\n```\nl6 ($0.10 vs. $0.94)\n$$\nx=1\n$$';
      const out = escapeCurrencyMath(input);
      expect(out.split('\n').length).toBe(input.split('\n').length);
    });
  });
});
