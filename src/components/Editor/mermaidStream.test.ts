import { describe, it, expect } from 'vitest';
import { StringStream } from '@codemirror/language';

import { mermaidLang } from './mermaidStream';

// Drive the StreamParser over a single line and collect (text, tag) pairs.
function tokens(line: string): Array<[string, string | null]> {
  const stream = new StringStream(line, 2, 2);
  const state = mermaidLang.startState!(2);
  const out: Array<[string, string | null]> = [];
  let guard = 0;
  while (!stream.eol() && guard++ < 500) {
    stream.start = stream.pos;
    const tag = mermaidLang.token(stream, state);
    if (stream.pos === stream.start) stream.next(); // ensure progress
    out.push([line.slice(stream.start, stream.pos), tag]);
  }
  return out;
}

function tagOf(line: string, text: string): string | null | undefined {
  return tokens(line).find(([tok]) => tok === text)?.[1];
}

describe('mermaidLang StreamParser', () => {
  it('tags diagram keywords as keyword', () => {
    expect(tagOf('graph TD', 'graph')).toBe('keyword');
    expect(tagOf('sequenceDiagram', 'sequenceDiagram')).toBe('keyword');
    expect(tagOf('subgraph one', 'subgraph')).toBe('keyword');
  });

  it('tags node ids as variableName, not keyword', () => {
    expect(tagOf('graph TD', 'TD')).toBe('keyword'); // TD is a direction keyword
    expect(tagOf('A --> B', 'A')).toBe('variableName');
    expect(tagOf('A --> B', 'B')).toBe('variableName');
  });

  it('tags arrows/edges as operator', () => {
    expect(tagOf('A --> B', '-->')).toBe('operator');
    expect(tokens('A -.-> B').some(([, tag]) => tag === 'operator')).toBe(true);
  });

  it('tags %% comments and strings', () => {
    expect(tokens('%% a note').some(([, tag]) => tag === 'comment')).toBe(true);
    expect(tokens('A["label"]').some(([tok, tag]) => tok === '"label"' && tag === 'string')).toBe(
      true,
    );
  });
});
