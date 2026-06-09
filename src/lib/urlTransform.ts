import { defaultUrlTransform } from 'react-markdown';

/**
 * URL transform for `<Markdown urlTransform>` (task 06-10-absolute-paths).
 *
 * react-markdown's `defaultUrlTransform` treats a leading `C:` as a URL scheme
 * and blanks absolute Windows paths — so `![](C:/x.png)` / `<img src="D:\y.png">`
 * never reach `resolveImageSrc` (which CAN handle them). We pass those through.
 *
 *   - Windows drive (`C:\…` / `C:/…`) and UNC (`\\server\…`): kept as-is.
 *   - POSIX-absolute (`/abs/…`): no special case needed — `defaultUrlTransform`
 *     already keeps it (no colon before a slash).
 *   - Everything else: delegate to `defaultUrlTransform`, which keeps relative
 *     paths + safe protocols (http/https/mailto/…) and BLANKS `javascript:`,
 *     `data:`, `vbscript:`, and unknown schemes.
 *
 * Passing an absolute path through here is safe: it is still gated downstream by
 * `resolveImageSrc` (img → only http(s) + absolute-local → convertFileSrc) and
 * `linkRouter` (a → only http(s)/mailto/anchor/local-md; local-other refused).
 * It adds no new filesystem reach beyond what relative `../` traversal + the
 * `**` asset scope already allow.
 */
const ABSOLUTE_LOCAL = /^[a-zA-Z]:[\\/]/;

export function urlTransform(url: string): string {
  if (ABSOLUTE_LOCAL.test(url) || url.startsWith('\\\\')) {
    return url;
  }
  return defaultUrlTransform(url);
}
