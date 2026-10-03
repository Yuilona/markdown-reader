// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';

import type { LoadedDocument, TextCodec } from '../../lib/tauri';

// saveDocument is the disk write; we make it a DEFERRED promise per test so
// we can interleave "user keeps typing during the save await".
const { saveDocument } = vi.hoisted(() => ({ saveDocument: vi.fn() }));
vi.mock('../../lib/tauri', () => ({ saveDocument }));
const UTF8_OUTCOME = { codec: { encoding: 'UTF-8', bom: false }, fellBackToUtf8: false };
vi.mock('../../lib/settingsStore', () => ({
  getSettings: vi.fn().mockResolvedValue({ editor: { defaultMode: 'read' } }),
}));
vi.mock('../Toast/useToast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../../lib/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { EditModeProvider, type EditModeContextValue } from './EditModeProvider';
import { useEditMode } from './useEditMode';

let ctx: EditModeContextValue;
let setDocExternally: (doc: LoadedDocument | null) => void;

function Capture() {
  ctx = useEditMode();
  return null;
}

function Harness({ initialDoc }: { initialDoc: LoadedDocument | null }) {
  const [doc, setDoc] = useState<LoadedDocument | null>(initialDoc);
  setDocExternally = setDoc;
  // onDocTextSync mirrors App.tsx: after a save, the parent refreshes the
  // LoadedDocument to the just-written text + codec (same path).
  const onDocTextSync = (text: string, codec: TextCodec) =>
    setDoc((d) => (d ? { ...d, text, codec } : d));
  return (
    <EditModeProvider doc={doc} onDocTextSync={onDocTextSync} onSaveAs={async () => null}>
      <Capture />
    </EditModeProvider>
  );
}

/** Flush the mount effect that loads settings.editor.defaultMode. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('EditModeProvider self-write race (PR-A guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves text typed DURING a save (does not clobber with the echo)', async () => {
    let resolveSave!: () => void;
    saveDocument.mockImplementation(
      () => new Promise((res) => {
        resolveSave = () => res(UTF8_OUTCOME);
      }),
    );

    render(<Harness initialDoc={{ path: '/a.md', text: 'old' }} />);
    await settle();

    act(() => ctx.setBufferText('edited'));
    expect(ctx.dirty).toBe(true);

    // Kick off save — saveDocument is pending (deferred).
    let savePromise: Promise<boolean>;
    act(() => {
      savePromise = ctx.save();
    });

    // User keeps typing while the disk write is in flight.
    act(() => ctx.setBufferText('edited-more'));

    // Disk write completes → save() calls onDocTextSync('edited'), which
    // bumps doc.text to 'edited'. The self-write guard must NOT reset the
    // buffer back to 'edited' — the newer 'edited-more' wins.
    await act(async () => {
      resolveSave();
      await savePromise;
    });

    expect(ctx.bufferText).toBe('edited-more');
    // No codec on the doc → saveDocument's UTF-8 default applies.
    expect(saveDocument).toHaveBeenCalledWith('/a.md', 'edited', undefined);
  });

  it('adopts a genuine external change (not a self-write) by resetting the buffer', async () => {
    saveDocument.mockResolvedValue(UTF8_OUTCOME);
    render(<Harness initialDoc={{ path: '/a.md', text: 'old' }} />);
    await settle();

    // Clean buffer; an external editor rewrites the file.
    act(() => setDocExternally({ path: '/a.md', text: 'EXTERNAL EDIT' }));

    expect(ctx.bufferText).toBe('EXTERNAL EDIT');
    expect(ctx.dirty).toBe(false);
  });

  it('resets the buffer when switching to a different file', async () => {
    saveDocument.mockResolvedValue(UTF8_OUTCOME);
    render(<Harness initialDoc={{ path: '/a.md', text: 'aaa' }} />);
    await settle();
    act(() => ctx.setBufferText('aaa-edited'));

    act(() => setDocExternally({ path: '/b.md', text: 'bbb' }));

    expect(ctx.bufferText).toBe('bbb');
    expect(ctx.dirty).toBe(false);
  });
});
