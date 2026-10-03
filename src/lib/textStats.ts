/**
 * Word count + reading-time estimate for the status bar.
 *
 * A whitespace split badly undercounts CJK (a whole Chinese paragraph has
 * no spaces, so it counted as one "word"). Count the way Chinese editors
 * do instead: every CJK character is one 字, and each run of Latin letters
 * / digits is one word. Punctuation and markdown syntax (`#`, `*`, `|`, …)
 * count as neither.
 *
 * Reading time uses typical silent-reading speeds: ~400 CJK characters and
 * ~200 Latin words per minute.
 */

// Han (incl. ext. A + compatibility), kana, Hangul syllables.
const CJK_CHAR = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g;
// Letters/digits from any script except the CJK ranges above, joined by
// inner apostrophes / hyphens / dots ("don't", "e-mail", "1.4.7").
const WORD = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;

const CJK_PER_MINUTE = 400;
const WORDS_PER_MINUTE = 200;

export interface TextStats {
  /** CJK characters + non-CJK words. */
  words: number;
  /** Estimated reading time in whole minutes (≥ 1 for non-empty text). */
  minutes: number;
}

export function textStats(text: string): TextStats {
  const cjk = text.match(CJK_CHAR)?.length ?? 0;
  const latin = text.replace(CJK_CHAR, ' ').match(WORD)?.length ?? 0;
  const words = cjk + latin;
  const minutes = words === 0 ? 0 : Math.max(1, Math.round(cjk / CJK_PER_MINUTE + latin / WORDS_PER_MINUTE));
  return { words, minutes };
}
