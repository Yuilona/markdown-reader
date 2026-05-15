import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  /** Children passed by react-markdown for the `<pre>` override:
   *  always the inner `<code>` React element (post-Shiki). */
  children?: ReactNode;
}

/**
 * Wraps a fenced code block (Shiki-rendered `<pre><code>`) with a
 * floating language label and a Copy button (R3.10).
 *
 * The wrapper preserves Shiki's existing inline styles + classes so the
 * highlight palette renders unchanged. Layout-wise:
 *   - The outer div is `position: relative` so the toolbar can be
 *     absolutely positioned in the top-right.
 *   - The toolbar contains the language label (always visible, low-key)
 *     and the Copy button (fades in on hover).
 *   - The Copy success state shows a check mark for 1500ms.
 */
export function CodeBlock({ children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  // Track the pending revert timer so a quick unmount (e.g. user
  // closes the document within the 1.5s flash window) cancels it
  // before React would warn about a state update on an unmounted node.
  const revertTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (revertTimerRef.current !== null) {
        window.clearTimeout(revertTimerRef.current);
        revertTimerRef.current = null;
      }
    };
  }, []);

  // The single child of `<pre>` from react-markdown is always a `<code>`
  // React element. We read its className for the language tag and walk
  // its children to recover the raw text for the clipboard.
  const codeElement = findCodeElement(children);
  const language = extractLanguage(codeElement);
  const rawText = extractText(codeElement);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      // Replace any in-flight revert timer so back-to-back copies don't
      // race the flash off mid-display.
      if (revertTimerRef.current !== null) {
        window.clearTimeout(revertTimerRef.current);
      }
      revertTimerRef.current = window.setTimeout(() => {
        revertTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch (err) {
      // PR-8 will route this to a toast; for PR-2 we just log.
      // eslint-disable-next-line no-console
      console.warn('[markdown-reader] copy failed:', err);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        {language && <span className={styles.lang}>{language}</span>}
        <button
          type="button"
          className={styles.copyBtn}
          onClick={handleCopy}
          aria-label="Copy code"
          title="复制"
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
      {/* Render the original `<pre>` markup; react-markdown built it as
       *  the children of this override. We rebuild a `<pre>` here because
       *  this component IS the `<pre>` override. */}
      <pre className={styles.pre}>{children}</pre>
    </div>
  );
}

/** Walk the React children looking for the `<code>` element (always
 *  the only child of `<pre>` for fenced blocks). */
function findCodeElement(children: ReactNode): ReactElement<{ className?: string; children?: ReactNode }> | null {
  let found: ReactElement<{ className?: string; children?: ReactNode }> | null = null;
  Children.forEach(children, (child) => {
    if (found) return;
    if (isValidElement(child) && child.type === 'code') {
      found = child as ReactElement<{ className?: string; children?: ReactNode }>;
    }
  });
  return found;
}

/** Pull the language from the `language-xxx` class (added by Shiki via
 *  the `addLanguageClass: true` option in markdownPlugins.ts). */
function extractLanguage(
  code: ReactElement<{ className?: string; children?: ReactNode }> | null,
): string | null {
  if (!code) return null;
  const className = code.props.className;
  if (typeof className !== 'string') return null;
  const match = className.match(/language-([a-zA-Z0-9_+-]+)/);
  if (!match) return null;
  const lang = match[1].toLowerCase();
  // `text` (our Shiki fallbackLanguage) is not a useful label; suppress.
  return lang === 'text' ? null : lang;
}

/** Recursively concatenate text nodes from a React tree. Shiki's output
 *  is nested `<span>`s, so we descend into all `props.children`. */
function extractText(node: ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  return '';
}
