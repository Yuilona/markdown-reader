import styles from './Frontmatter.module.css';

interface FrontmatterProps {
  /** Raw YAML source text (without the surrounding `---` fences). */
  raw: string;
}

/**
 * Collapsible widget shown ABOVE the markdown body when the document has
 * YAML frontmatter (R3.5).
 *
 * Hidden by default; uses native `<details>` / `<summary>` so toggling
 * works without JS. The raw YAML is shown verbatim — parsing the value
 * into a definition list is overkill for v0.1, and most readers will
 * recognize the YAML form anyway.
 *
 * Returns `null` when there is no frontmatter so the caller can render
 * unconditionally.
 */
export function Frontmatter({ raw }: FrontmatterProps) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  return (
    <details className={styles.details}>
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
      <pre className={styles.body}>
        <code>{trimmed}</code>
      </pre>
    </details>
  );
}
