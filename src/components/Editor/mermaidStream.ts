import type { StreamParser } from '@codemirror/language';

/**
 * Minimal Mermaid highlighter for the editor's ```mermaid fenced blocks.
 *
 * CodeMirror 6 has no maintained Mermaid grammar (the one npm package,
 * codemirror-lang-mermaid, is stale, ~1.4 MB, and misses several diagram
 * types), so this is a hand-rolled `StreamParser` — same mechanism as the
 * Shell entry in codeLanguages.ts. The `token()` return values are standard
 * highlight tag names (keyword / operator / comment / string / number /
 * variableName), which the editor's existing fallback highlighter
 * (defaultHighlightStyle / oneDarkHighlightStyle, editorExtensions.ts) colors
 * with no new HighlightStyle needed.
 *
 * Scope: "decent, not perfect" — keyword + arrow + comment + string + node-id
 * coloring across the common diagram types. Perfect tokenization would need a
 * real Lezer grammar; that's out of scope.
 */

const KEYWORDS = new Set([
  // diagram headers / declarations
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'journey', 'mindmap',
  'gitGraph', 'quadrantChart', 'timeline', 'requirementDiagram', 'C4Context',
  // structural
  'subgraph', 'end', 'direction',
  // sequence
  'participant', 'actor', 'note', 'activate', 'deactivate', 'loop', 'alt',
  'opt', 'else', 'par', 'and', 'rect', 'over', 'left', 'right', 'of',
  'autonumber', 'as',
  // class / state / er
  'class', 'state', 'title', 'section',
  // gantt
  'dateFormat', 'axisFormat', 'excludes', 'todayMarker',
  // pie
  'showData',
  // flow directions
  'TB', 'TD', 'BT', 'RL', 'LR',
]);

// Longest arrows first so e.g. `-.->` wins over `--`. Trailing `|` lets the
// `-->|label|` opener be matched as an operator (the label text then falls
// through to variableName, the closing `|` is matched below).
const ARROW = /^(?:<-->|x--x|o--o|-\.->|<-\.-|==>|<==|===|--x|x--|--o|o--|-->|<--|---|-\.-|~~~|==|--)\|?/;

export const mermaidLang: StreamParser<Record<string, never>> = {
  name: 'mermaid',
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) return null;

    // %% line comments
    if (stream.match(/^%%.*/)) return 'comment';
    // double- or single-quoted strings / labels
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    // edge / arrow operators (incl. the `-->|` label opener)
    if (stream.match(ARROW)) return 'operator';
    // edge-label / link pipes
    if (stream.match(/^\|/)) return 'operator';
    // numbers (gantt durations, pie values, autonumber)
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';

    // identifiers → keyword or node id
    const word = stream.match(/^[A-Za-z_][\w-]*/) as RegExpMatchArray | null;
    if (word) {
      return KEYWORDS.has(word[0]) ? 'keyword' : 'variableName';
    }

    // shape / bracket delimiters
    if (stream.match(/^[[\](){}>]/)) return 'operator';

    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '%%' } },
};
