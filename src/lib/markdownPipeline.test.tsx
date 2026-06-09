// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Markdown from 'react-markdown';
import type { PluggableList } from 'unified';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';

import { sanitizeSchema } from './sanitizeSchema';
import { rehypeMermaidPretag } from './rehypeMermaidPretag';

// The raw-HTML + sanitize core of the DocumentView rehype chain (task
// 06-10-raw-html-render). We test through react-markdown (the real consumer)
// without Shiki/sourceLine so the assertions stay focused on raw + sanitize.
const RAW_SANITIZE: PluggableList = [rehypeRaw, [rehypeSanitize, sanitizeSchema]];

function renderMd(md: string, rehypePlugins: PluggableList = RAW_SANITIZE): HTMLElement {
  const { container } = render(
    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
      {md}
    </Markdown>,
  );
  return container;
}

describe('raw HTML rendering (rehype-raw + sanitize)', () => {
  it('renders an HTML <img> and keeps src/alt/width (defaultSchema omits alt)', () => {
    const c = renderMd('<img src="pic.png" alt="hi" width="40">');
    const img = c.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('pic.png');
    expect(img!.getAttribute('alt')).toBe('hi');
    expect(img!.getAttribute('width')).toBe('40');
  });

  it('renders a hand-written HTML <table> and keeps colspan + alignment', () => {
    const c = renderMd(
      '<table><thead><tr><th align="right" colspan="2">A</th></tr></thead>' +
        '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(c.querySelector('table')).not.toBeNull();
    const th = c.querySelector('th') as HTMLTableCellElement | null;
    expect(th).not.toBeNull();
    expect(th!.colSpan).toBe(2);
    // react-markdown converts table-cell `align` into a textAlign style at render.
    expect(th!.style.textAlign).toBe('right');
    expect(c.querySelectorAll('td').length).toBe(2);
  });

  it('still renders a GFM pipe table alongside a raw HTML <img> in one doc', () => {
    const c = renderMd(['| a | b |', '| - | - |', '| 1 | 2 |', '', '<img src="x.png" alt="z">'].join('\n'));
    expect(c.querySelector('table')).not.toBeNull();
    expect(c.querySelectorAll('th').length).toBe(2);
    expect(c.querySelector('img')?.getAttribute('alt')).toBe('z');
  });

  it('renders common safe formatting elements (details/summary, sub/sup, kbd, mark)', () => {
    const c = renderMd(
      '<details open><summary>more</summary>body</details> H<sub>2</sub>O x<sup>2</sup> <kbd>Ctrl</kbd> <mark>hi</mark>',
    );
    expect(c.querySelector('details')).not.toBeNull();
    expect(c.querySelector('summary')).not.toBeNull();
    expect(c.querySelector('sub')).not.toBeNull();
    expect(c.querySelector('sup')).not.toBeNull();
    expect(c.querySelector('kbd')).not.toBeNull();
    expect(c.querySelector('mark')).not.toBeNull();
  });
});

describe('XSS / privacy battery — each dangerous construct MUST be neutralized', () => {
  it('strips <script> entirely', () => {
    const c = renderMd('<script>window.__pwn = 1</script><p>ok</p>');
    expect(c.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwn?: number }).__pwn).toBeUndefined();
  });

  it('strips inline on* event-handler attributes (onerror)', () => {
    const c = renderMd('<img src="x" onerror="window.__pwn2 = 1">');
    const img = c.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('onerror')).toBeNull();
  });

  it('strips <iframe>', () => {
    const c = renderMd('<iframe src="http://evil.example/x"></iframe><p>ok</p>');
    expect(c.querySelector('iframe')).toBeNull();
  });

  it('strips <style> (the material CSP-allowed CSS-exfil residual)', () => {
    const c = renderMd('<style>body{background:url(http://evil.example/track)}</style><p>ok</p>');
    expect(c.querySelector('style')).toBeNull();
  });

  it('strips inline style= attribute', () => {
    const c = renderMd('<p style="position:fixed;background:url(http://evil.example/t)">x</p>');
    const p = c.querySelector('p');
    expect(p).not.toBeNull();
    // sanitize removes the author style attr; nothing should set inline style here.
    expect(p!.getAttribute('style')).toBeNull();
  });

  it('strips <meta http-equiv=refresh> and <base href>', () => {
    const c = renderMd('<meta http-equiv="refresh" content="0;url=http://evil.example"><base href="http://evil.example/"><p>ok</p>');
    expect(c.querySelector('meta')).toBeNull();
    expect(c.querySelector('base')).toBeNull();
  });

  it('neutralizes javascript: URLs in <a href>', () => {
    const c = renderMd('<a href="javascript:window.__pwn3=1">click</a>');
    const a = c.querySelector('a');
    expect(a).not.toBeNull();
    const href = a!.getAttribute('href') ?? '';
    expect(href.toLowerCase().startsWith('javascript:')).toBe(false);
  });
});

describe('absolute local paths — blanked UPSTREAM by react-markdown urlTransform (pre-existing, not sanitize)', () => {
  it('markdown ![](E:/...) src is blanked even with NO sanitize in the chain', () => {
    // Only rehype-raw, no sanitize: react-markdown's defaultUrlTransform sees
    // the leading `E:` as a disallowed URL scheme and blanks the src.
    const c = renderMd('![x](E:/Desktop/a/b.png)', [rehypeRaw]);
    const img = c.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src') ?? '').toBe('');
  });

  it('relative img src DOES survive the full raw+sanitize chain (the common case)', () => {
    const c = renderMd('![x](assets/p.png)');
    expect(c.querySelector('img')?.getAttribute('src')).toBe('assets/p.png');
  });
});

describe('mermaid pre-tagging survives sanitize (data-mermaid-source whitelist)', () => {
  it('keeps data-mermaid-source on <pre> AND renders adjacent raw HTML', () => {
    const md = ['```mermaid', 'graph TD; A-->B;', '```', '', '<div class="x">hello</div>'].join('\n');
    const c = renderMd(md, [rehypeMermaidPretag, ...RAW_SANITIZE]);
    // The mermaid pre-tagger sets data-mermaid-source BEFORE sanitize; the
    // schema whitelists it on <pre>, so the routing marker must survive.
    expect(c.querySelector('pre[data-mermaid-source]')).not.toBeNull();
    // The adjacent raw HTML <div> still renders.
    expect(c.querySelector('div')).not.toBeNull();
    expect(c.textContent).toContain('hello');
  });
});
