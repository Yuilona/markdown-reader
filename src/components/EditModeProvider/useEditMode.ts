import { useContext } from 'react';

import { EditModeContext, type EditModeContextValue } from './EditModeProvider';

/**
 * Hook for reading the edit-mode context (v1.0 PR-A).
 *
 * Returns a SAFE no-op fallback when no provider is mounted (mode
 * 'read' + empty buffer + no-op setters) so components that ALSO mount
 * outside the provider (e.g. unit tests that render Titlebar in
 * isolation) don't crash. App.tsx always mounts the provider in
 * practice — the no-op path is exclusively a developer-ergonomics
 * safety net.
 */
export function useEditMode(): EditModeContextValue {
  const value = useContext(EditModeContext);
  if (!value) {
    return NOOP;
  }
  return value;
}

const NOOP: EditModeContextValue = {
  mode: 'read',
  setMode: async () => undefined,
  toggleMode: async () => undefined,
  bufferText: '',
  setBufferText: () => undefined,
  dirty: false,
  save: async () => undefined,
  cursor: null,
  setCursor: () => undefined,
  wordCount: 0,
};
