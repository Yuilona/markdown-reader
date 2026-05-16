import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { open as shellOpen } from '@tauri-apps/plugin-shell';

import * as logger from '../../lib/logger';
import type { ToastContextValue } from '../Toast/ToastProvider';

/**
 * Context-menu action helpers (PR-8, R6.7 + R7.7 + R14.5).
 *
 * Extracted from DocumentView so the component's right-click handlers
 * stay readable. Each helper:
 *   - Wraps the underlying API in try/catch
 *   - Logs failures via the rolling logger
 *   - Surfaces a toast on success/failure as appropriate
 *
 * The `toast` parameter is the `useToast()` value; we pass it in
 * explicitly rather than calling the hook inside these module-scoped
 * helpers (hooks may only be called from React function components).
 */

/**
 * Detect whether the image src is a local file (Tauri's asset URL).
 * convertFileSrc rewrites local paths to `https://asset.localhost/...`
 * on Windows. Anything else (https://other, blob:, data:) is treated
 * as remote / inline.
 */
export function isLocalAssetUrl(url: string): boolean {
  return url.startsWith('https://asset.localhost/') || url.startsWith('asset://');
}

/**
 * Extract the original local filesystem path from a Tauri asset URL.
 * Returns null if the URL isn't a local asset.
 */
export function localPathFromAssetUrl(url: string): string | null {
  // `https://asset.localhost/<encoded path>` or `asset://localhost/<path>`
  const match =
    url.match(/^https:\/\/asset\.localhost\/(.+)$/) ??
    url.match(/^asset:\/\/localhost\/(.+)$/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    // Tauri encodes Windows paths as `C:/foo/bar.png`; normalize to
    // backslash form so the OS APIs (shell.open / fs.writeFile) accept
    // it.
    return decoded.replace(/\//g, '\\');
  } catch {
    return null;
  }
}

/** Copy plain text to the clipboard. */
async function writeClipboardText(text: string): Promise<void> {
  // `navigator.clipboard.writeText` works inside Tauri WebView2 without
  // a plugin (it's a browser-native API).
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard text API is not available');
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Copy a link href to the clipboard. Shows a success/error toast.
 * R7.7 "Copy link address".
 */
export async function copyLinkAddress(
  href: string,
  toast: ToastContextValue,
): Promise<void> {
  try {
    await writeClipboardText(href);
    toast.show('已复制链接地址', { variant: 'success' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn('Copy link address failed:', err);
    toast.show('复制失败', { variant: 'error', details: detail });
  }
}

/**
 * Open a link in the system default browser. R7.7 "Open in browser".
 * Used by the link context menu — same call path as the normal click
 * handler, but bypasses the in-app routing for local .md links so the
 * user can force an external open.
 */
export async function openLinkInBrowser(
  href: string,
  toast: ToastContextValue,
): Promise<void> {
  try {
    await shellOpen(href);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn('Open in browser failed:', href, err);
    toast.show('无法打开链接', { variant: 'error', details: detail });
  }
}

/**
 * Copy an image to the system clipboard as a PNG blob. R6.7 / R14.5.
 *
 * Approach:
 *   - Fetch the resolved src (works for both http(s) and the local
 *     `https://asset.localhost/...` URL).
 *   - Convert the response body to a blob.
 *   - Re-encode through a canvas so the clipboard receives a
 *     `image/png`-typed blob regardless of the source format (the
 *     clipboard API on Windows pastes PNG into most apps; JPEG/WEBP
 *     get poor handling in many surfaces).
 *   - Write via `navigator.clipboard.write([ClipboardItem])`.
 */
export async function copyImageToClipboard(
  resolvedSrc: string,
  toast: ToastContextValue,
): Promise<void> {
  try {
    const blob = await fetchImageAsPng(resolvedSrc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ClipboardItemCtor = (window as any).ClipboardItem;
    if (!ClipboardItemCtor || !navigator.clipboard?.write) {
      throw new Error('Clipboard image-write API is not available');
    }
    await navigator.clipboard.write([
      new ClipboardItemCtor({ 'image/png': blob }),
    ]);
    toast.show('已复制图片', { variant: 'success' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn('Copy image to clipboard failed:', resolvedSrc, err);
    toast.show('复制图片失败', { variant: 'error', details: detail });
  }
}

/**
 * Show a save dialog and write the image bytes to the chosen path.
 * R6.7 "Save as...".
 */
export async function saveImageToDisk(
  resolvedSrc: string,
  suggestedName: string,
  toast: ToastContextValue,
): Promise<void> {
  try {
    const targetPath = await save({
      title: '保存图片',
      defaultPath: suggestedName,
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      ],
    });
    if (typeof targetPath !== 'string') {
      // User cancelled — no toast.
      return;
    }
    const response = await fetch(resolvedSrc);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching image`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(targetPath, bytes);
    toast.show('已保存图片', { variant: 'success' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn('Save image to disk failed:', resolvedSrc, err);
    toast.show('保存图片失败', { variant: 'error', details: detail });
  }
}

/**
 * Open the image in the system's default viewer. R6.7 "Open in system
 * viewer". Only works for local images — remote URLs are not opened
 * (we'd have to download them first, which the user can do via "Save
 * as..." then open manually).
 */
export async function openImageInSystem(
  resolvedSrc: string,
  toast: ToastContextValue,
): Promise<void> {
  const localPath = localPathFromAssetUrl(resolvedSrc);
  if (!localPath) {
    toast.show('远程图片无法用系统默认应用打开', {
      variant: 'info',
    });
    return;
  }
  try {
    await shellOpen(localPath);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn('Open image in system failed:', localPath, err);
    toast.show('无法打开图片', { variant: 'error', details: detail });
  }
}

/**
 * Fetch an image URL and re-encode as a PNG blob for clipboard use.
 *
 * Why re-encode through canvas:
 *   - Clipboard receivers (Word, Slack, browsers' paste targets) handle
 *     PNG most reliably. Pasting JPEG/WEBP/SVG yields mixed results.
 *   - The fetch path returns the source bytes; we let the canvas
 *     standardize to PNG.
 */
async function fetchImageAsPng(url: string): Promise<Blob> {
  // SVG fetched as-is needs rasterizing — same code path works because
  // an Image element knows how to draw an SVG source.
  return await new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, img.naturalWidth);
        canvas.height = Math.max(1, img.naturalHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to acquire 2D canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('canvas.toBlob returned null'));
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      reject(new Error('Failed to load image into Image element'));
    };
    img.src = url;
  });
}
