/**
 * Escape currency dollar signs so `remark-math` doesn't mistake them for
 * inline-math delimiters.
 *
 * THE BUG: `micromark-extension-math@3.1.0` (under remark-math 6) treats any
 * `$…$` as inline math — its only `$` guard prevents `$$`, NOT currency. A
 * document like `…($0.94/case). Despite … ($0.10 vs. $0.94)…` has its prose
 * between two currency signs swallowed into a KaTeX formula: math mode eats
 * the spaces (text collapses to `Despitethecompetitive…`) and never wraps
 * (it overflows the page). Seen in `samples/GoS.md`.
 *
 * THE FIX: before the string reaches react-markdown, prefix `\` to any `$`
 * that begins a *currency amount* — `$` immediately followed by
 * `<digits>[,<groups>].<decimals>` with NO spaces. remark-math then renders
 * it literally. We deliberately require the decimal point with no spaces so
 * REAL math is never touched:
 *   - `$0 = b_{0} < \dots$` — `$0 ` has a space + no decimal → not currency.
 *   - `$1 . 0$`            — space between `1` and `.`          → not currency.
 *   - `$h_t^*$`            — no leading digit                  → not currency.
 *
 * Pure integer currency (`$5`, no decimals) is intentionally NOT handled: it
 * is indistinguishable from digit-leading math like `$0 = …` and doesn't
 * occur in practice; authors can hand-escape `\$5` if ever needed.
 *
 * Code and display math are skipped so their `$` are preserved verbatim:
 * fenced code (``` / ~~~), inline code (`…`), display math ($$…$$), and
 * already-escaped `\$`. A document's ```txt block listing `'$16.05 to
 * $40.98'` (as in `samples/HiPER.md`) must stay byte-for-byte intact.
 *
 * Line-count safe: only inserts `\` characters, never newlines, so the
 * `data-source-line` stamps from `rehypeSourceLine` (line-based) still line
 * up with the editor buffer.
 */

// Regions whose `$` must be left alone. Matched and returned verbatim so the
// currency rule never sees inside them. Order matters only in that these are
// tried alongside the currency alternative at each scan position.
const SKIP = [
  '\\$\\$[\\s\\S]*?\\$\\$', // display math: $$ … $$
  '```[\\s\\S]*?```', // fenced code block (backticks)
  '~~~[\\s\\S]*?~~~', // fenced code block (tildes)
  '`[^`\\n]*`', // inline code span
  '\\\\\\$', // an already-escaped \$ — don't double-escape
].join('|');

// Currency amount: `$` + (thousands-grouped int | plain int) + `.` + 1–2
// decimals, all with no intervening spaces. Captured so the replacer can tell
// a currency hit (escape it) from a skipped region (leave it).
const CURRENCY = '\\$(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{1,2}';

const TOKEN = new RegExp(`(?:${SKIP})|(${CURRENCY})`, 'g');

/**
 * Prefix `\` to currency `$` signs in a Markdown string, leaving code,
 * display math, and real inline math untouched. Idempotent.
 */
export function escapeCurrencyMath(md: string): string {
  return md.replace(TOKEN, (match, currency: string | undefined) =>
    currency ? '\\' + currency : match,
  );
}
