import { useEffect, useState, useCallback } from 'react';

import { readRecent, removeRecent, type RecentEntry } from '../../lib/recentFiles';
import { basename, dirname } from '../../lib/pathUtils';
import styles from './EmptyState.module.css';

interface RecentListProps {
  /** Invoked when the user clicks a recent row. Caller loads the file. */
  onPick: (path: string) => void;
}

/**
 * Renders up to 10 recently-opened files from recent.json.
 * Loaded on mount; reloaded whenever the parent calls `refresh()` via the
 * exposed `key` change pattern is unnecessary — we expose a `refresh`
 * callback through ref via the parent re-mount approach (simpler: parent
 * passes a `version` key that bumps when a file opens).
 *
 * Empty state: "暂无最近文件" (R2.5 Chinese-only UI).
 *
 * Each row: filename (basename) + dirname greyed + relative timestamp.
 * Clicking the row triggers `onPick`. A small "✕" button removes the
 * entry from recent.json without opening it.
 */
export function RecentList({ onPick }: RecentListProps) {
  const [entries, setEntries] = useState<RecentEntry[] | null>(null);

  const refresh = useCallback(async () => {
    const list = await readRecent();
    setEntries(list.files);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRemove = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation(); // prevent the row's onClick from firing
    const next = await removeRecent(path);
    setEntries(next.files);
  };

  if (entries === null) {
    // Initial load — render nothing rather than flash the empty message.
    return <div className={styles.recent} aria-busy="true" />;
  }

  return (
    <div className={styles.recent}>
      <p className={styles.recentTitle}>最近文件</p>
      {entries.length === 0 ? (
        <p className={styles.recentEmpty}>暂无最近文件</p>
      ) : (
        <ul className={styles.recentList}>
          {entries.map((entry) => (
            <li
              key={entry.path}
              className={styles.recentItem}
              onClick={() => onPick(entry.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onPick(entry.path);
                }
              }}
              title={entry.path}
            >
              <div className={styles.recentInfo}>
                <span className={styles.recentName}>{basename(entry.path)}</span>
                <span className={styles.recentDir}>{dirname(entry.path)}</span>
              </div>
              <span className={styles.recentTime}>{formatRelative(entry.lastOpened)}</span>
              <button
                type="button"
                className={styles.recentRemove}
                onClick={(e) => handleRemove(e, entry.path)}
                aria-label="从列表中移除"
                title="从列表中移除"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Cheap relative-time formatter. No deps. Buckets:
 *   < 1 min  → "刚刚"
 *   < 1 h    → "N 分钟前"
 *   today    → "今天 HH:MM"
 *   yesterday→ "昨天"
 *   < 7 days → "N 天前"
 *   else     → "YYYY-MM-DD"
 */
function formatRelative(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;

  // Same calendar day?
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  if (sameDay) {
    const hh = String(then.getHours()).padStart(2, '0');
    const mm = String(then.getMinutes()).padStart(2, '0');
    return `今天 ${hh}:${mm}`;
  }

  // Yesterday?
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === then.getFullYear() &&
    yesterday.getMonth() === then.getMonth() &&
    yesterday.getDate() === then.getDate();
  if (isYesterday) return '昨天';

  if (diffDay < 7 && diffDay >= 0) return `${diffDay} 天前`;
  // Hour-based fallback for the weird "negative diff" (clock skew) cases.
  if (diffHr < 1) return '刚刚';

  // ISO YYYY-MM-DD fallback.
  const y = then.getFullYear();
  const m = String(then.getMonth() + 1).padStart(2, '0');
  const d = String(then.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
