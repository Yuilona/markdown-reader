import { useEffect, useState } from 'react';

import type { Settings } from '../lib/settings';
import { getSettings, subscribeSettings } from '../lib/settingsStore';

/**
 * Live settings: the persisted values once loaded (null until then), kept
 * current with every change made through the settings store — e.g. from
 * the settings panel — so consumers update without a restart.
 */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    const unsubscribe = subscribeSettings(setSettings);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return settings;
}
