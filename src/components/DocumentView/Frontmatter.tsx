import { useFrontmatter } from './FrontmatterContext';
import styles from './Frontmatter.module.css';

interface FrontmatterProps {
  /** Raw YAML source text (without the surrounding `---` fences). */
  raw: string;
}

/**
 * Collapsible widget shown ABOVE the markdown body when the document has
 * YAML frontmatter (R3.5).
 *
 * Hidden by default; uses native `<details>` / `<summary>` for the
 * disclosure affordance, but the open state is lifted into
 * `FrontmatterContext` (PR-7) so the SearchBar can read it for R8.10
 * (search inside frontmatter only when expanded). The native `open`
 * attribute is now driven from context state; `onToggle` keeps the two
 * in sync if the user activates the disclosure via keyboard or
 * accessibility tooling.
 *
 * Returns `null` when there is no frontmatter so the caller can render
 * unconditionally.
 */
export function Frontmatter({ raw }: FrontmatterProps) {
  const trimmed = raw.trim();
  const { isExpanded, setExpanded } = useFrontmatter();
  if (!trimmed) return null;

  return (
    <details
      className={styles.details}
      open={isExpanded}
      onToggle={(e) => {
        // Mirror the native `open` state back into context. We treat the
        // DOM as authoritative here (rather than calling preventDefault
        // and re-driving from React) so screen-reader / keyboard
        // activation still works as expected — Chromium implements the
        // disclosure toggle in the user agent.
        setExpanded((e.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden="true">
          {/* Document-with-corner-fold glyph; conveys "metadata header". */}
          <svg width="14" height="14" viewBox="0 0 16 16">
            <path
              fill="currentColor"
              d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.329.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.043-.05-2.895-2.895-.043-.043Z"
            />
          </svg>
        </span>
        <span className={styles.label}>Frontmatter</span>
      </summary>
      {/* `data-frontmatter-body`: marker used by the SearchBar's skip-
        * selector logic. When `isExpanded` is false the SearchBar adds
        * `[data-frontmatter-body]` to its skip list; when true it
        * removes it so frontmatter text becomes searchable (R8.10). */}
      <pre className={styles.body} data-frontmatter-body>
        <code>{trimmed}</code>
      </pre>
    </details>
  );
}
