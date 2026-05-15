import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Listener for the `second-instance` event emitted by the Rust side
 * (tauri-plugin-single-instance). When a second copy of the app is
 * launched, its argv is forwarded here.
 *
 * PR-1: just log the payload. PR-5 will inspect argv[1] for a file path
 * and load it into the running window.
 */
export async function registerSecondInstanceListener(): Promise<UnlistenFn | null> {
  try {
    const unlisten = await listen<string[]>('second-instance', (event) => {
      // eslint-disable-next-line no-console
      console.log('[markdown-reader] second-instance argv:', event.payload);
    });
    return unlisten;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[markdown-reader] failed to register second-instance listener:', err);
    return null;
  }
}
