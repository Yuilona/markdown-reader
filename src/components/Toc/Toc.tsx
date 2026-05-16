import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTocHeadings, type TocHeading } from './useTocHeadings';
import styles from './Toc.module.css';

interface TocProps {
  /** Ref pointing at the article element whose headings we extract. */
  articleRef: RefObject<HTMLElement | null>;
  /** Ref pointing at the scroll container (the IntersectionObserver root). */
  scrollRef: RefObject<HTMLElement | null>;
  /** Re-extract trigger — typically `doc.path + doc.text` joined. */
  versionKey: string;
  /** Whether the sidebar is currently visible. */
  visible: boolean;
  /** Close the sidebar (× button inside the panel). */
  onClose: () => void;
  /** Open the sidebar (small floating button when collapsed). */
  onOpen: () => void;
  /** PR-7 Feature 3: when the SearchBar is open it sits in the same
   *  top-right corner as the TOC and they share both `top` and `right`.
   *  We shift the TOC down by ~48px when search is open so its header
   *  isn't hidden behind the SearchBar overlay. */
  searchOpen: boolean;
}

/**
 * Right-side TOC sidebar (R3.6 + R14.2-R14.4).
 *
 * Layout choice (per PRD architecture sketch):
 *   - `position: fixed`, anchored to the right edge of the viewport.
 *   - Width 260px (within the 240-280 recommended range).
 *   - The article column stays centered at 820px max-width regardless
 *     of the TOC's presence — we never push or shrink the article.
 *     On wide viewports the TOC sits in the right margin; on narrow
 *     viewports it overlays the article (still readable: the 820px
 *     column gets letterboxed by the OS automatically and the TOC
 *     covers the right portion, which is mostly empty padding anyway).
 *
 * Click → smooth scroll to the heading via `getElementById` (R14.2).
 *   We use `CSS.escape` on the id because rehype-slug emits
 *   percent-encoded / unicode-safe ids that may contain characters
 *   that are valid in HTML `id=` but invalid in CSS selectors. (Note:
 *   we still use `getElementById` which doesn't need escaping — the
 *   `CSS.escape` is reserved for any future querySelector path.)
 *
 * Current-section highlighting (R14.3):
 *   `IntersectionObserver` with the scroll container as root, observing
 *   every heading the TOC tracks. The "current" heading is the one
 *   highest in the viewport (rootMargin biases the entry zone to the
 *   top 20-40% band). State holds the id of the currently-highlighted
 *   entry; the TOC item with that id gets the `current` style.
 *
 * No collapsible sub-headings (R14.4): every heading is rendered as
 *   a flat list, indented by level. h1 sits at indent 0; h2..h6
 *   indent additional 16px per level.
 *
 * Empty headings → render nothing (R3.6 implies the sidebar is only
 *   useful when there's content). The toggle button in DocumentView
 *   stays visible regardless, but the panel itself disappears.
 */
export function Toc({
  articleRef,
  scrollRef,
  versionKey,
  visible,
  onClose,
  onOpen,
  searchOpen,
}: TocProps) {
  const headings = useTocHeadings(articleRef, versionKey);
  const [currentId, setCurrentId] = useState<string | null>(null);
  // Track the ids we're observing so we can disconnect/reconnect when
  // the headings list changes (e.g. file reload).
  const observerRef = useRef<IntersectionObserver | null>(null);

  // ---- IntersectionObserver: set `currentId` as user scrolls. ----
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || headings.length === 0) {
      setCurrentId(null);
      return;
    }

    // A heading is "active" when its TOP enters the band roughly
    // 20%-40% from the top of the scroll viewport. The negative
    // bottom margin (-60%) excludes headings that are too far below
    // the band, so the active heading is always the deepest one
    // currently inside the upper band.
    //
    // The trade-off: with this band, a heading is briefly "active"
    // as it enters AND as the next one is about to enter. We pick
    // the heading whose intersection is most recently positive AND
    // whose position is highest among the candidates.
    const visibleIds = new Set<string>();

    const handleEntries: IntersectionObserverCallback = (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).id;
        if (entry.isIntersecting) {
          visibleIds.add(id);
        } else {
          visibleIds.delete(id);
        }
      }
      // Choose the heading whose DOM position is highest (smallest
      // `offsetTop`). Reading offsetTop on each heading is O(n) but
      // n is typically <100; the alternative (cache positions) would
      // be invalidated by every Mermaid / KaTeX async layout pass.
      if (visibleIds.size === 0) return;
      let bestId: string | null = null;
      let bestTop = Infinity;
      for (const id of visibleIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.offsetTop;
        if (top < bestTop) {
          bestTop = top;
          bestId = id;
        }
      }
      if (bestId) setCurrentId(bestId);
    };

    const obs = new IntersectionObserver(handleEntries, {
      root,
      // Top: 0 (the heading must enter the visible region). Bottom: -60%
      // means a heading is considered "left the active band" once it's
      // scrolled past the upper 40% of the viewport. This biases the
      // "current" heading to the one closest to where the user is
      // reading, not the one at the very bottom of the viewport.
      rootMargin: '0px 0px -60% 0px',
      threshold: 0,
    });
    observerRef.current = obs;
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) obs.observe(el);
    }
    return () => {
      obs.disconnect();
      observerRef.current = null;
    };
  }, [headings, scrollRef]);

  const handleClick = (id: string) => {
    // `getElementById` is selector-free, so no need to escape. We add a
    // small offset to compensate for the floating TOC toggle / future
    // titlebar bleeds — `scrollIntoView` honors `block: 'start'` which
    // sets the heading flush to the top, which can be hidden behind the
    // 32px frameless titlebar. The scrollArea itself is BELOW the
    // titlebar in flex flow, so its scrollIntoView coords are already
    // relative to the visible scroll viewport — no offset needed.
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setCurrentId(id);
  };

  // Memoize the rendered list so visibility toggle doesn't re-walk
  // the headings array unnecessarily. The list itself is small but
  // the render produces fresh DOM each pass.
  const items = useMemo(() => headings, [headings]);

  // No headings → render nothing at all (no panel, no toggle). The
  // empty case is meaningless and a stray toggle button is just noise.
  if (items.length === 0) return null;

  // When the panel is hidden, show a small floating button (R3.6's
  // "small icon button" affordance — placed top-right of the scroll
  // area). When SearchBar is open the toggle slides down to avoid the
  // overlay, mirroring the panel's own offset rule below.
  if (!visible) {
    const toggleClass = searchOpen
      ? `${styles.openToggle} ${styles.openToggleBelowSearch}`
      : styles.openToggle;
    return (
      <button
        type="button"
        className={toggleClass}
        onClick={onOpen}
        aria-label="打开目录"
        title="打开目录 (Ctrl+\\)"
        data-no-search
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          {/* Three-bar TOC glyph. */}
          <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <line x1="3" y1="4.5" x2="13" y2="4.5" />
            <line x1="3" y1="8" x2="13" y2="8" />
            <line x1="3" y1="11.5" x2="13" y2="11.5" />
          </g>
        </svg>
      </button>
    );
  }

  const className = searchOpen
    ? `${styles.sidebar} ${styles.sidebarBelowSearch}`
    : styles.sidebar;

  return (
    <aside
      className={className}
      aria-label="目录"
      // data-no-search: the TOC text shadows the article headings.
      // Letting search match here would inflate the count with one
      // duplicate per visible match.
      data-no-search
    >
      <div className={styles.header}>
        <span className={styles.title}>目录</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="关闭目录"
          title="关闭目录 (Ctrl+\\)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M 1.5,1.5 L 10.5,10.5 M 10.5,1.5 L 1.5,10.5"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <ul className={styles.list}>
        {items.map((h) => (
          <TocItem
            key={h.id}
            heading={h}
            isCurrent={h.id === currentId}
            onClick={handleClick}
          />
        ))}
      </ul>
    </aside>
  );
}

interface TocItemProps {
  heading: TocHeading;
  isCurrent: boolean;
  onClick: (id: string) => void;
}

function TocItem({ heading, isCurrent, onClick }: TocItemProps) {
  // h1 at indent 0; h2 indented 1 step, etc. Step = 12px which keeps
  // the deepest h6 (5 steps = 60px) inside the 260px column even with
  // a long heading text. We render a `<button>` instead of `<a href>`
  // because we DON'T want the browser's default anchor scroll (which
  // skips our smooth + observer-update flow).
  const indent = Math.max(0, heading.level - 1) * 12;
  const className = isCurrent
    ? `${styles.item} ${styles.current}`
    : styles.item;
  return (
    <li>
      <button
        type="button"
        className={className}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={() => onClick(heading.id)}
        title={heading.text}
      >
        {heading.text}
      </button>
    </li>
  );
}
