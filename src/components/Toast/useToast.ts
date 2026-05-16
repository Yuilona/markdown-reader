import { useContext } from 'react';

import { ToastContext, type ToastContextValue } from './ToastProvider';

/**
 * Hook for posting toasts. Must be called from within a <ToastProvider>.
 *
 * Returns a stable object with `show / dismiss / clear` — see
 * `ToastProvider.tsx` for the full contract. Throws (rather than
 * returning a silent no-op) so a missing provider surfaces during
 * development instead of silently dropping error messages.
 */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast() must be used within <ToastProvider>.');
  }
  return value;
}
