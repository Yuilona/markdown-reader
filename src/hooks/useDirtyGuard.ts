import { useCallback, useEffect } from 'react';

import { useConfirm } from '../components/ConfirmDialog/useConfirm';

/**
 * Dirty-guard hook (v1.0 PR-A, R-EDIT-5.4).
 *
 * Wraps "close-like" actions (Ctrl+W close-document, Ctrl+Q quit,
 * window ✕ button) with the standard three-button prompt when the
 * current buffer has unsaved changes:
 *
 *   [放弃] [取消] [保存并继续]
 *
 * Returns a `guardedAction(proceed)` function. The proceed callback
 * is the work the caller wanted to do (e.g. `setDoc(null)` for
 * Ctrl+W). If the buffer is clean, proceed runs immediately. If it's
 * dirty, the user picks:
 *   - 放弃     → proceed runs (changes are discarded).
 *   - 取消     → proceed is NOT called; the action is aborted.
 *   - 保存并继续 → save() is awaited first; on success proceed runs.
 *                  On save failure, proceed is NOT called (the user
 *                  needs to fix the write error before continuing).
 *
 * Also wires a `window.beforeunload` listener while dirty so the
 * browser (and Tauri's window-close path in some cases) warns the
 * user before closing.
 *
 * Independence: this hook does NOT itself listen for Ctrl+W / Ctrl+Q
 * keys. Those are owned by useShortcuts; useShortcuts receives the
 * guarded callbacks as props from App.tsx, which wires them via
 * useDirtyGuard. Keeping the keymap and the guard separate means the
 * same guard can wrap the window-close-requested path too without
 * duplicating logic.
 */

export type GuardedAction = (proceed: () => void | Promise<void>) => Promise<void>;

interface DirtyGuardResult {
  /** Wrap any "destructive" action with the unsaved-changes prompt. */
  guardedAction: GuardedAction;
}

export function useDirtyGuard(
  dirty: boolean,
  save: () => Promise<void>,
): DirtyGuardResult {
  const confirm = useConfirm();

  // beforeunload: the browser-native "you have unsaved changes" prompt.
  // Tauri's webview honors this for window.close paths in most builds;
  // when it doesn't, the onCloseRequested handler in App.tsx is the
  // canonical guard. This is a belt-and-suspenders.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // The actual prompt text is controlled by the browser nowadays;
      // setting returnValue is the cross-browser signal that "there's
      // something to prompt about".
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const guardedAction = useCallback<GuardedAction>(
    async (proceed) => {
      if (!dirty) {
        await proceed();
        return;
      }
      const choice = await confirm({
        title: '有未保存的修改',
        message: '当前文档有未保存的更改。是否继续？',
        buttons: [
          { value: 'discard', label: '放弃', variant: 'danger' },
          { value: 'cancel', label: '取消', variant: 'secondary' },
          { value: 'save', label: '保存并继续', variant: 'primary' },
        ],
        cancelValue: 'cancel',
      });
      if (choice === 'cancel') return;
      if (choice === 'save') {
        try {
          await save();
        } catch {
          // save() already showed an error toast; abort.
          return;
        }
      }
      // 'discard' OR 'save' (after a successful save) → run the proceed.
      await proceed();
    },
    [dirty, save, confirm],
  );

  return { guardedAction };
}
