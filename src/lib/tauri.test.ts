import { describe, it, expect, vi, beforeEach } from 'vitest';

// Document I/O goes through the Rust `read_document` / `write_document`
// commands (encoding detection + atomic write live in
// src-tauri/src/text_codec.rs, tested there with `cargo test`). Here we
// check the frontend contract: arguments in, codec info passed through.
const { invoke, pushRecent } = vi.hoisted(() => ({ invoke: vi.fn(), pushRecent: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('./recentFiles', () => ({ pushRecent }));
vi.mock('./logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { codecLabel, loadDocument, saveDocument, UTF8_CODEC } from './tauri';

const GBK = { encoding: 'GBK', bom: false };

describe('loadDocument (encoding-aware read)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads via read_document and keeps the detected codec', async () => {
    invoke.mockResolvedValue({ text: '# 中文', codec: GBK, malformed: false });

    const doc = await loadDocument('C:\\docs\\gbk.md');

    expect(invoke).toHaveBeenCalledWith('read_document', { path: 'C:\\docs\\gbk.md' });
    expect(doc).toEqual({ path: 'C:\\docs\\gbk.md', text: '# 中文', codec: GBK, malformed: false });
    expect(pushRecent).toHaveBeenCalledWith('C:\\docs\\gbk.md');
  });

  it('returns null (no throw) when the read fails, and skips non-markdown paths', async () => {
    invoke.mockRejectedValue('no such file');
    expect(await loadDocument('C:\\docs\\gone.md')).toBeNull();
    expect(await loadDocument('C:\\docs\\x.exe')).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('saveDocument (encoding-preserving write)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes in the document codec and returns the outcome', async () => {
    const outcome = { codec: GBK, fellBackToUtf8: false };
    invoke.mockResolvedValue(outcome);

    await expect(saveDocument('C:\\docs\\gbk.md', '新内容', GBK)).resolves.toEqual(outcome);
    expect(invoke).toHaveBeenCalledWith('write_document', {
      path: 'C:\\docs\\gbk.md',
      text: '新内容',
      codec: GBK,
    });
  });

  it('defaults to UTF-8 when the document has no codec (unnamed buffer)', async () => {
    invoke.mockResolvedValue({ codec: UTF8_CODEC, fellBackToUtf8: false });
    await saveDocument('C:\\docs\\new.md', 'x');
    expect(invoke.mock.calls[0][1]).toMatchObject({ codec: UTF8_CODEC });
  });

  it('propagates a write failure so the caller can show the error', async () => {
    invoke.mockRejectedValue(new Error('disk full'));
    await expect(saveDocument('C:\\docs\\note.md', 'data')).rejects.toThrow('disk full');
  });
});

describe('codecLabel', () => {
  it('labels only non-default encodings', () => {
    expect(codecLabel(undefined)).toBeNull();
    expect(codecLabel(UTF8_CODEC)).toBeNull();
    expect(codecLabel({ encoding: 'UTF-8', bom: true })).toBe('UTF-8 BOM');
    expect(codecLabel(GBK)).toBe('GBK');
    expect(codecLabel({ encoding: 'UTF-16LE', bom: true })).toBe('UTF-16LE');
  });
});
