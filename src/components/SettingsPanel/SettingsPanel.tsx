import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getVersion } from '@tauri-apps/api/app';

import { useSettings } from '../../hooks/useSettings';
import { updateEditorSettings, updateSettings } from '../../lib/settingsStore';
import type { EditorDefaultMode, ThemeMode } from '../../lib/settings';
import {
  disableUserCss,
  getUserCssStatus,
  restoreBundledTheme,
  type UserCssStatus,
} from '../../lib/userCss';
import { getDataDir } from '../../lib/tauri';
import * as logger from '../../lib/logger';
import { useTheme } from '../ThemeProvider/useTheme';
import { usePageZoom } from '../PageZoom/usePageZoom';
import { useConfirm } from '../ConfirmDialog/useConfirm';
import { useToast } from '../Toast/useToast';
import styles from './SettingsPanel.module.css';

/**
 * Settings panel (Ctrl+, or the titlebar gear): a GUI over settings.json,
 * which used to be edit-by-hand only. Every control applies immediately —
 * theme and page zoom through their providers (which persist), the rest
 * through the settings store, whose subscribers (useSettings) update live.
 *
 * Not exposed: `splitRatio` (set by dragging the splitter) and
 * `editor.autoSave` (not implemented).
 *
 * Also manages data/user.css (see userCss.ts): restore the built-in theme
 * or switch to the plain default style, both applied without a restart.
 */
interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

const MODE_OPTIONS: Array<{ value: EditorDefaultMode; label: string }> = [
  { value: 'read', label: '阅读' },
  { value: 'edit', label: '编辑' },
];

const TAB_OPTIONS = [2, 4, 8].map((n) => ({ value: n, label: String(n) }));

const THEME_STATUS_TEXT: Record<UserCssStatus, string> = {
  bundled: '内置 Claude 主题（随新版本自动更新）',
  custom: '自定义样式（你改过，不会被自动覆盖）',
  none: '未启用（使用默认样式）',
};

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const settings = useSettings();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const { zoom, zoomIn, zoomOut, resetZoom } = usePageZoom();
  const rawConfirm = useConfirm();
  const toast = useToast();

  // While a confirmation is stacked above the panel, Esc belongs to it.
  // (Our window listener was registered first, so it would otherwise run
  // first and close the panel out from under the dialog.)
  const confirmOpenRef = useRef(false);
  const confirm: typeof rawConfirm = async (opts) => {
    confirmOpenRef.current = true;
    try {
      return await rawConfirm(opts);
    } finally {
      confirmOpenRef.current = false;
    }
  };

  const [themeStatus, setThemeStatus] = useState<UserCssStatus | null>(null);
  const [version, setVersion] = useState('');
  const [dataDir, setDataDir] = useState('');

  const refreshThemeStatus = useCallback(() => {
    getUserCssStatus()
      .then(setThemeStatus)
      .catch((err) => logger.warn('failed to read user.css status:', err));
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshThemeStatus();
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(''));
    getDataDir()
      .then(setDataDir)
      .catch(() => setDataDir(''));
  }, [open, refreshThemeStatus]);

  // Esc closes — unless a confirm dialog (stacked above) is handling it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmOpenRef.current) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleRestoreTheme = async () => {
    if (themeStatus === 'custom') {
      const choice = await confirm({
        title: '恢复内置主题？',
        message: '当前 user.css 是你自定义过的样式，恢复后会被内置 Claude 主题覆盖。',
        buttons: [
          { value: 'cancel', label: '取消' },
          { value: 'ok', label: '覆盖并恢复', variant: 'danger' },
        ],
      });
      if (choice !== 'ok') return;
    }
    try {
      await restoreBundledTheme();
      toast.show('已恢复内置 Claude 主题', { variant: 'success' });
    } catch (err) {
      toast.show('恢复主题失败', { variant: 'error', details: String(err) });
    }
    refreshThemeStatus();
  };

  const handleDisableTheme = async () => {
    if (themeStatus === 'custom') {
      const choice = await confirm({
        title: '停用主题？',
        message: '这会删除你自定义过的 user.css，改用默认样式。',
        buttons: [
          { value: 'cancel', label: '取消' },
          { value: 'ok', label: '删除并停用', variant: 'danger' },
        ],
      });
      if (choice !== 'ok') return;
    }
    try {
      await disableUserCss();
      toast.show('已停用主题，改用默认样式', { variant: 'success' });
    } catch (err) {
      toast.show('停用主题失败', { variant: 'error', details: String(err) });
    }
    refreshThemeStatus();
  };

  if (!open) return null;
  const editor = settings?.editor;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-print-hide
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div className={styles.header}>
          <h2 className={styles.heading} id="settingsTitle">
            设置
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭设置">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <Section title="外观">
            <Row label="配色">
              <Segmented options={THEME_OPTIONS} value={themeMode} onChange={setThemeMode} />
            </Row>
            <Row label="页面缩放" hint="阅读模式下正文的缩放比例（Ctrl+= / Ctrl+-）">
              <div className={styles.stepper}>
                <button type="button" onClick={zoomOut} aria-label="缩小">
                  −
                </button>
                <button type="button" onClick={resetZoom} title="重置为 100%" className={styles.stepperValue}>
                  {zoom}%
                </button>
                <button type="button" onClick={zoomIn} aria-label="放大">
                  +
                </button>
              </div>
            </Row>
          </Section>

          <Section title="阅读">
            <Row label="默认显示目录" hint="也可以随时用 Ctrl+\ 切换">
              <Switch
                checked={settings?.showTocByDefault ?? true}
                onChange={(v) => void updateSettings({ showTocByDefault: v })}
              />
            </Row>
          </Section>

          <Section title="编辑">
            <Row label="打开文件时进入">
              <Segmented
                options={MODE_OPTIONS}
                value={editor?.defaultMode ?? 'read'}
                onChange={(v) => void updateEditorSettings({ defaultMode: v })}
              />
            </Row>
            <Row label="编辑时同步滚动预览">
              <Switch
                checked={editor?.scrollSync ?? true}
                onChange={(v) => void updateEditorSettings({ scrollSync: v })}
              />
            </Row>
            <Row label="显示行号">
              <Switch
                checked={editor?.lineNumbers ?? false}
                onChange={(v) => void updateEditorSettings({ lineNumbers: v })}
              />
            </Row>
            <Row label="自动换行">
              <Switch
                checked={editor?.lineWrap ?? true}
                onChange={(v) => void updateEditorSettings({ lineWrap: v })}
              />
            </Row>
            <Row label="缩进宽度">
              <Segmented
                options={TAB_OPTIONS}
                value={editor?.tabSize ?? 2}
                onChange={(v) => void updateEditorSettings({ tabSize: v })}
              />
            </Row>
          </Section>

          <Section title="主题文件（data/user.css）">
            <Row label="当前" hint={themeStatus ? THEME_STATUS_TEXT[themeStatus] : '读取中…'}>
              <div className={styles.actions}>
                {themeStatus !== null && themeStatus !== 'bundled' && (
                  <button type="button" className={styles.actionBtn} onClick={() => void handleRestoreTheme()}>
                    恢复内置主题
                  </button>
                )}
                {themeStatus !== null && themeStatus !== 'none' && (
                  <button type="button" className={styles.actionBtn} onClick={() => void handleDisableTheme()}>
                    停用主题
                  </button>
                )}
              </div>
            </Row>
          </Section>

          <Section title="关于">
            <Row label="版本">
              <span className={styles.value}>{version ? `v${version}` : '—'}</span>
            </Row>
            <Row label="数据目录" hint="设置、最近文件、主题等都保存在这里">
              <span className={`${styles.value} ${styles.path}`} title={dataDir}>
                {dataDir || '—'}
              </span>
            </Row>
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.labelCol}>
        <div className={styles.label}>{label}</div>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchKnob} />
    </button>
  );
}

function Segmented<V extends string | number>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: V; label: string }>;
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          className={`${styles.segment} ${opt.value === value ? styles.segmentActive : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
