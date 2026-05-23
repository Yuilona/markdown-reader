import { describe, it, expect } from 'vitest';
import { splitFrontmatter, frontmatterLineOffset } from './parseFrontmatter';

describe('splitFrontmatter', () => {
  it('returns null when there is no frontmatter', () => {
    expect(splitFrontmatter('# hello\n\nbody')).toBeNull();
  });

  it('splits a leading --- fenced YAML block from the body', () => {
    const text = '---\ntitle: Hi\ntags: [a, b]\n---\n# Body\n\npara';
    const r = splitFrontmatter(text);
    expect(r).not.toBeNull();
    expect(r!.raw).toBe('title: Hi\ntags: [a, b]');
    expect(r!.body).toBe('# Body\n\npara');
  });

  it('returns null when the closing fence is missing', () => {
    expect(splitFrontmatter('---\ntitle: Hi\n# body')).toBeNull();
  });

  it('tolerates a UTF-8 BOM and CRLF line endings', () => {
    const text = '﻿---\r\na: 1\r\n---\r\nbody';
    const r = splitFrontmatter(text);
    expect(r).not.toBeNull();
    expect(r!.raw).toBe('a: 1');
  });
});

describe('frontmatterLineOffset', () => {
  it('is 0 when there is no frontmatter', () => {
    expect(frontmatterLineOffset('')).toBe(0);
  });

  it('counts the YAML lines plus the two --- fences', () => {
    expect(frontmatterLineOffset('title: Hi\ntags: [a, b]')).toBe(4);
  });

  it('maps a body line back to the full-buffer line', () => {
    // Buffer lines (1-indexed): 1:'---' 2:'a: 1' 3:'b: 2' 4:'---'
    //                           5:'# Heading' 6:'' 7:'para'
    const text = '---\na: 1\nb: 2\n---\n# Heading\n\npara';
    const r = splitFrontmatter(text)!;
    const offset = frontmatterLineOffset(r.raw);
    expect(offset).toBe(4);
    // '# Heading' is body line 1 → buffer line 1 + offset = 5. ✓
    const bodyLineOfHeading = 1;
    expect(bodyLineOfHeading + offset).toBe(5);
  });
});
