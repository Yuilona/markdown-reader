import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type Settings,
  type ThemeMode,
} from '../../lib/settings';
import { setMermaidTheme, type MermaidTheme } from '../../lib/mermaidLazy';
import * as logger from '../../lib/logger';

/**
 * Theme system (R9.1-R9.2, R10.2, R4.3).
 *
 * Three modes:
 *   - 'light'   — always light.
 *   - 'dark'    — always dark.
 *   - 'system'  — track `prefers-color-scheme`.
 *
 * `effective` is what's actually painted: resolves 'system' against the
 * OS preference. The DOM toggle is `data-theme="light" | "dark"` on
 * `<html>`; CSS variables in `theme.light.css` / `theme.dark.css` flip
 * to match, and the 200ms fade (R9.2) is enforced by `transitions.css`.
 *
 * Mermaid re-rendering (R4.3, R4.4):
 *   When `effective` flips, `setMermaidTheme()` is called which
 *   re-initializes mermaid AND clears the previous-theme cache slice.
 *   Mermaid components subscribe to the same theme context — their
 *   render effect depends on `mermaidTheme` so a theme flip naturally
 *   re-runs `mermaid.render()` and produces SVGs in the new palette.
 *
 * Persistence:
 *   The selected `mode` is written through to `settings.json` on every
 *   change. We do NOT persist `effective` — it's a derived value.
 */

export interface ThemeContextValue {
  /** What the user picked (or the persisted default). Tri-state. */
  mode: ThemeMode;
  /** Currently painted theme. Always 'light' | 'dark'. */
  effective: 'light' | 'dark';
  /** Change the mode. Persists to settings.json and reflects to DOM. */
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
export { ThemeContext };

/** Resolve 'system' against the OS preference. Pure helper — no DOM
 *  side-effects. */
function resolveEffective(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  // 'system': read the OS preference once. The provider's effect below
  // subscribes to the matchMedia change event for live updates.
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  return mql.matches ? 'dark' : 'light';
}

/** Map our app-effective theme to the Mermaid theme name. */
function mermaidThemeFor(effective: 'light' | 'dark'): MermaidTheme {
  return effective === 'dark' ? 'dark' : 'default';
}

/** Apply `data-theme` to <html>. Centralized so any later "force theme
 *  for print" path (PR-8) can compose with the same DOM toggle. */
function applyTheme(effective: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = effective;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Default to 'system' while settings.json is loading — gives the
  // correct first paint on the vast majority of installs. The async
  // read below promotes to the persisted value, which is usually the
  // same so no visible re-flip occurs.
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_SETTINGS.theme);
  const [effective, setEffective] = useState<'light' | 'dark'>(() =>
    resolveEffective(DEFAULT_SETTINGS.theme),
  );

  // Track whether the initial settings load has completed. Until it
  // does, we suppress the "write settings on mode change" effect so
  // the default mount doesn't immediately re-write the file with
  // its own loaded value (a harmless but ugly disk churn).
  const initializedRef = useRef(false);

  /** The most-recent settings snapshot read from disk. Used by the
   *  write-back effect to preserve fields PR-6 doesn't manage. */
  const persistedSettingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  // ---- Mount: load persisted mode. ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await readSettings();
      if (cancelled) return;
      persistedSettingsRef.current = settings;
      setModeState(settings.theme);
      setEffective(resolveEffective(settings.theme));
      // Flag set AFTER state updates so the [mode] write-back effect
      // sees it as true on its next firing (which will be triggered by
      // the setModeState above if the value differs from the default).
      initializedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Apply theme to DOM + Mermaid whenever `effective` changes. ----
  useEffect(() => {
    applyTheme(effective);
    // Sync Mermaid's palette. `setMermaidTheme` is idempotent (no-op
    // when the requested theme matches the current one), so calling
    // it on every effective change — including the initial mount —
    // is safe and keeps the wiring single-source-of-truth.
    void setMermaidTheme(mermaidThemeFor(effective));
  }, [effective]);

  // ---- Persist `mode` to settings.json whenever it changes
  //      (after the initial load completes). ----
  useEffect(() => {
    if (!initializedRef.current) return;
    // Round-trip the OTHER persisted fields so a user's pageZoom /
    // showTocByDefault aren't clobbered.
    const updated: Settings = {
      ...persistedSettingsRef.current,
      theme: mode,
    };
    persistedSettingsRef.current = updated;
    void writeSettings(updated).catch((err) => {
      // PR-8: route persistence failures through the rolling logger so
      // a write error lands in data/logs/app.log on top of the console.
      // logger.warn mirrors to console.warn under the hood so the prior
      // DevTools behavior is preserved.
      logger.warn('failed to write settings.json:', err);
    });
  }, [mode]);

  // ---- Subscribe to OS prefers-color-scheme only while mode === 'system'. ----
  useEffect(() => {
    if (mode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    // Re-sync to the CURRENT OS value on subscribe — guards against a
    // stale effective value when toggling to 'system' after the OS
    // preference drifted since mount.
    setEffective(mql.matches ? 'dark' : 'light');
    const onChange = (e: MediaQueryListEvent) => {
      setEffective(e.matches ? 'dark' : 'light');
    };
    // `addEventListener` is supported in WebView2; the older
    // `addListener` fallback isn't needed for this browser target.
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [mode]);

  // ---- Public setter: update mode + effective. ----
  // Side-effects (Mermaid sync + persistence) are decoupled into the
  // dedicated effects above. This keeps `setMode` synchronous and
  // double-invocation-safe (matters for StrictMode in dev).
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    // Compute effective from `next` directly (not from current state)
    // because setState is asynchronous — we need the new effective
    // applied this tick so the visible flip is instant.
    setEffective(resolveEffective(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, effective, setMode }),
    [mode, effective, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
