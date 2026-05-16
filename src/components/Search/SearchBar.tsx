import { useEffect, type RefObject } from 'react';
import { useSearch, type SearchFlags } from './useSearch';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  /** Ref to the article element the search walker scans. */
  articleRef: RefObject<HTMLElement | null>;
  /** Whether the bar is visible (open). */
  open: boolean;
  /** Close the bar (Esc / × button). Also clears highlights. */
  onClose: () => void;
  /** True when the lightbox is currently open. If so, the SearchBar's
   *  Esc handler defers to the lightbox's handler — we don't want one
   *  Esc keypress to close both. */
  lightboxOpen: boolean;
  /** Ref forwarded so the parent's Ctrl+F handler can re-select the
   *  input when the bar is already open. */
  inputRef: RefObject<HTMLInputElement>;
  /** Forwarded to `useSearch` — bumps re-walks when the article DOM
   *  is replaced (doc swap / watcher reload). */
  versionKey: string;
}

/**
 * Floating Ctrl+F search overlay (R8.1-R8.11, PR-7).
 *
 * Positioning: top-right of the document area, fixed, ~380px wide
 * (within the architecture sketch's "comfortable" band). Z-index sits
 * above the TOC sidebar so they don't visually collide.
 *
 * Keyboard rules implemented HERE (the global Ctrl+F open lives in
 * `useShortcuts`):
 *   - Enter / F3            → next match
 *   - Shift+Enter / Shift+F3 → previous match
 *   - Esc                   → close (unless lightbox is open)
 *
 * The bar renders nothing when `open === false` so DOM doesn't carry
 * an empty input around. The query string is held in the hook (module
 * state via `useSearch`), so re-opening pre-fills the previous value
 * — and the input's onFocus selects it so the user can immediately
 * type to replace.
 */
export function SearchBar({
  articleRef,
  open,
  onClose,
  lightboxOpen,
  inputRef,
  versionKey,
}: SearchBarProps) {
  const search = useSearch({ articleRef, isOpen: open, versionKey });

  // Keyboard handler attached to the input field. Document-level Esc
  // listener handles "close even when the input doesn't have focus"
  // — but during normal use the input IS focused so this branch is the
  // primary path. We stopPropagation() on the keys we own so the
  // document-level handlers don't fire a second time (idempotent in
  // practice, but avoids double-work).
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) search.previous();
      else search.next();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) search.previous();
      else search.next();
      return;
    }
    if (e.key === 'Escape') {
      // Lightbox-open takes precedence (matches the document-level
      // handler's gating rule below). If the lightbox is showing, don't
      // close the SearchBar from the input — let the Lightbox's own
      // window-level Esc handler dismiss the topmost surface first.
      if (lightboxOpen) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
  };

  // Document-level Esc handler: catches the case where the user clicks
  // somewhere else (focus moves off the input) and then presses Esc.
  // Lightbox-open takes precedence — the Lightbox component owns its
  // own Esc listener; we no-op in that case so a single Esc press
  // closes one thing at a time, top of stack first.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lightboxOpen) return; // Lightbox handler takes priority.
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, lightboxOpen, onClose]);

  // F3 / Shift+F3 work as document-level shortcuts too (R8.3 — "F3"
  // and "Shift+F3" with no specific focus requirement).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'F3') return;
      // Only intercept when the bar owns the experience — when input
      // already handled it via the React onKeyDown, the event still
      // bubbles up; preventing default here is harmless either way.
      e.preventDefault();
      if (e.shiftKey) search.previous();
      else search.next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, search]);

  // Auto-focus the input every time the bar opens. The parent also
  // selects the existing query when re-opening (so the user can type
  // to replace) by calling `inputRef.current?.select()` in its own
  // open-handler — handled in DocumentView.
  useEffect(() => {
    if (open) {
      // Defer to the next tick so the input is in the DOM. Also select
      // the contents so the user's first keystroke replaces a stale
      // query.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, inputRef]);

  if (!open) return null;

  const counterText =
    search.total === 0 && search.query !== ''
      ? '0 / 0'
      : `${search.currentIndex + 1} / ${search.total}`;
  const counterClass = search.isInvalid || (search.query !== '' && search.total === 0)
    ? `${styles.counter} ${styles.counterEmpty}`
    : styles.counter;

  return (
    <div className={styles.bar} role="search" aria-label="文档内搜索">
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="搜索…"
        aria-label="搜索文本"
        spellCheck={false}
        autoComplete="off"
      />
      <span className={counterClass} aria-label="匹配计数">
        {counterText}
      </span>
      <div className={styles.toggles}>
        <ToggleButton
          flag="caseSensitive"
          value={search.flags.caseSensitive}
          onChange={(v) => search.setFlag('caseSensitive', v)}
          label="Aa"
          tooltip="区分大小写"
        />
        <ToggleButton
          flag="wholeWord"
          value={search.flags.wholeWord}
          onChange={(v) => search.setFlag('wholeWord', v)}
          label='""'
          tooltip="全字匹配"
        />
        <ToggleButton
          flag="regex"
          value={search.flags.regex}
          onChange={(v) => search.setFlag('regex', v)}
          label=".*"
          tooltip="正则表达式"
        />
      </div>
      <div className={styles.navGroup}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => search.previous()}
          aria-label="上一个匹配 (Shift+Enter)"
          title="上一个 (Shift+Enter)"
          disabled={search.total === 0}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M 2.5,7.5 L 6,4 L 9.5,7.5"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => search.next()}
          aria-label="下一个匹配 (Enter)"
          title="下一个 (Enter)"
          disabled={search.total === 0}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M 2.5,4.5 L 6,8 L 9.5,4.5"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <button
        type="button"
        className={`${styles.iconBtn} ${styles.closeBtn}`}
        onClick={onClose}
        aria-label="关闭搜索 (Esc)"
        title="关闭 (Esc)"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M 1,1 L 9,9 M 9,1 L 1,9"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

interface ToggleButtonProps {
  flag: keyof SearchFlags;
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  tooltip: string;
}

function ToggleButton({ flag, value, onChange, label, tooltip }: ToggleButtonProps) {
  const className = value
    ? `${styles.toggleBtn} ${styles.toggleBtnActive}`
    : styles.toggleBtn;
  return (
    <button
      type="button"
      className={className}
      onClick={() => onChange(!value)}
      aria-pressed={value}
      aria-label={tooltip}
      title={tooltip}
      // Use the flag name as a data attribute purely for E2E hooks if
      // we ever wire them up; no behavioral impact.
      data-search-flag={flag}
    >
      {label}
    </button>
  );
}
