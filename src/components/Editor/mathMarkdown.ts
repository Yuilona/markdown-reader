import { StreamLanguage } from '@codemirror/language';
import { stexMath } from '@codemirror/legacy-modes/mode/stex';
import { parseMixed } from '@lezer/common';
import { tags as t } from '@lezer/highlight';
import type {
  MarkdownConfig,
  InlineContext,
  BlockContext,
  Line,
} from '@lezer/markdown';

/**
 * KaTeX-style math highlighting for the editor's markdown parser.
 *
 * `@codemirror/lang-markdown` ships no math support and there is no maintained
 * npm extension, so this is a small vendored `MarkdownConfig`:
 *   - block  `$$ … $$`  (parseBlock, must run before FencedCode)
 *   - inline `$ … $`     (parseInline)
 * and the math *content* is tokenized by nesting the `stexMath` StreamLanguage
 * via the config-level `wrap: parseMixed(...)` (there is no per-node `nest`).
 * The `$`/`$$` markers reuse the markdown marker color (processingInstruction →
 * --cm-marker); the nested stex tokens are colored by the editor's existing
 * fallback highlighter — no new HighlightStyle needed.
 *
 * Inline rules mirror remark-math (used by the preview) to stay in agreement
 * and limit false matches on `$` in prose: the char after the opening `$` and
 * before the closing `$` must be non-space, and `\$` is treated as escaped.
 */

const DOLLAR = 36; // '$'
const BACKSLASH = 92; // '\'
const SPACE = 32;
const TAB = 9;

const stexMathParser = StreamLanguage.define(stexMath).parser;

const isSpace = (code: number) => code === SPACE || code === TAB;

export const Math: MarkdownConfig = {
  defineNodes: [
    { name: 'BlockMath', block: true, style: t.special(t.content) },
    { name: 'InlineMath', style: t.special(t.content) },
    { name: 'MathMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse(cx: BlockContext, line: Line): boolean {
        if (line.next !== DOLLAR) return false;
        if (line.text.slice(line.pos, line.pos + 2) !== '$$') return false;

        const start = cx.lineStart + line.pos;
        const marks = [cx.elt('MathMark', start, start + 2)];

        // Single-line:  $$ … $$
        const afterOpen = line.text.slice(line.pos + 2);
        const sameLineClose = afterOpen.indexOf('$$');
        if (sameLineClose >= 0) {
          const closeFrom = start + 2 + sameLineClose;
          marks.push(cx.elt('MathMark', closeFrom, closeFrom + 2));
          cx.addElement(cx.elt('BlockMath', start, closeFrom + 2, marks));
          cx.nextLine();
          return true;
        }

        // Multi-line: scan following lines for a closing `$$`.
        while (cx.nextLine()) {
          const idx = line.text.indexOf('$$');
          if (idx >= 0) {
            const closeFrom = cx.lineStart + idx;
            marks.push(cx.elt('MathMark', closeFrom, closeFrom + 2));
            cx.addElement(cx.elt('BlockMath', start, closeFrom + 2, marks));
            cx.nextLine();
            return true;
          }
        }

        // Unterminated: close at the end of what we consumed.
        cx.addElement(cx.elt('BlockMath', start, cx.prevLineEnd(), marks));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== DOLLAR) return -1;
        // Leave `$$` to the block parser; don't open inline on it.
        if (cx.char(pos + 1) === DOLLAR) return -1;
        // remark-math opener rule: non-space right after `$`.
        const after = cx.char(pos + 1);
        if (after < 0 || isSpace(after)) return -1;

        let i = pos + 1;
        for (; i < cx.end; i++) {
          const c = cx.char(i);
          if (c === BACKSLASH) {
            i++; // skip the escaped char (e.g. \$)
            continue;
          }
          if (c === DOLLAR) {
            // remark-math closer rule: non-space right before `$`.
            if (!isSpace(cx.char(i - 1))) break;
          }
        }
        if (i >= cx.end || cx.char(i) !== DOLLAR) return -1;
        if (i === pos + 1) return -1; // empty `$$`

        return cx.addElement(
          cx.elt('InlineMath', pos, i + 1, [
            cx.elt('MathMark', pos, pos + 1),
            cx.elt('MathMark', i, i + 1),
          ]),
        );
      },
    },
  ],
  // Nest stex into the math *content* (span minus the `$`/`$$` markers).
  wrap: parseMixed((node) => {
    if (node.name !== 'InlineMath' && node.name !== 'BlockMath') return null;
    const markLen = node.name === 'BlockMath' ? 2 : 1;
    const from = node.from + markLen;
    const to = node.to - markLen;
    if (to <= from) return null;
    return { parser: stexMathParser, overlay: [{ from, to }] };
  }),
};
