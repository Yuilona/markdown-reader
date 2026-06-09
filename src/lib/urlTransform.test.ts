import { describe, it, expect } from 'vitest';

import { urlTransform } from './urlTransform';

describe('urlTransform — passes absolute local paths, blanks dangerous protocols', () => {
  it('keeps Windows drive paths (forward and back slash)', () => {
    expect(urlTransform('C:/photos/x.png')).toBe('C:/photos/x.png');
    expect(urlTransform('D:\\a\\b.png')).toBe('D:\\a\\b.png');
  });

  it('keeps UNC paths', () => {
    expect(urlTransform('\\\\server\\share\\z.png')).toBe('\\\\server\\share\\z.png');
  });

  it('keeps POSIX-absolute, relative, http(s), mailto, and anchors', () => {
    expect(urlTransform('/home/u/x.png')).toBe('/home/u/x.png');
    expect(urlTransform('assets/x.png')).toBe('assets/x.png');
    expect(urlTransform('http://e.com/x.png')).toBe('http://e.com/x.png');
    expect(urlTransform('https://e.com/x.png')).toBe('https://e.com/x.png');
    expect(urlTransform('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(urlTransform('#section')).toBe('#section');
  });

  it('blanks javascript:/data:/vbscript: (delegated to defaultUrlTransform)', () => {
    expect(urlTransform('javascript:alert(1)')).toBe('');
    expect(urlTransform('data:text/html,<script>1</script>')).toBe('');
    expect(urlTransform('vbscript:msgbox(1)')).toBe('');
  });
});
