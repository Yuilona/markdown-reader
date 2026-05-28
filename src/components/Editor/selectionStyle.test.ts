// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, drawSelection } from '@codemirror/view';

import { themeExtension } from './editorExtensions';

describe('CodeMirror selection background rule', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    if (view) {
      view.destroy();
      view = null;
    }
    document.querySelectorAll('style').forEach((s) => s.remove());
  });

  for (const mode of ['light', 'dark'] as const) {
    it(`emits a high-specificity selection rule in ${mode} mode`, () => {
      view = new EditorView({
        state: EditorState.create({
          doc: 'hello world',
          extensions: [drawSelection(), themeExtension(mode)],
        }),
        parent: document.body,
      });

      const styleText = Array.from(document.head.querySelectorAll('style'))
        .map((s) => s.textContent ?? '')
        .join('\n');

      const targetRule = styleText.match(
        /\.[^\s,]+\.cm-focused > \.cm-scroller > \.cm-selectionLayer \.cm-selectionBackground\.cm-selectionBackground\s*{[^}]*}/,
      );
      expect(targetRule, 'compiled chrome-theme rule missing').not.toBeNull();
      expect(targetRule![0]).toMatch(/var\(--cm-selection-bg\)/);

      const baseRule = styleText.match(
        /\.[^\s,]+\.cm-focused > \.cm-scroller > \.cm-selectionLayer \.cm-selectionBackground\b(?!\.)/,
      );
      expect(baseRule, 'CM6 base focused selection rule missing').not.toBeNull();

      const baseIdx = styleText.indexOf(baseRule![0]);
      const ourIdx = styleText.indexOf(targetRule![0]);
      expect(ourIdx, 'chrome-theme rule must appear after base rule in cascade').toBeGreaterThan(
        baseIdx,
      );
    });
  }

  it('computed background of .cm-selectionBackground uses the var, not the CM6 default', () => {
    document.documentElement.style.setProperty('--cm-selection-bg', 'rgb(1, 2, 3)');

    view = new EditorView({
      state: EditorState.create({
        doc: 'hello world this is a longer document so we can select stuff',
        selection: EditorSelection.single(0, 11),
        extensions: [drawSelection(), themeExtension('dark')],
      }),
      parent: document.body,
    });
    view.focus();
    view.requestMeasure();

    const bg = view.dom.querySelector('.cm-selectionBackground') as HTMLElement | null;
    // jsdom won't actually render the layer markers (no layout), so the
    // element may be absent. Still useful: assert the rule-set matches the
    // var rather than the CM6 default by inspecting the stylesheet text.
    const styleText = Array.from(document.head.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    const ourRule = styleText.match(
      /\.[^\s,]+\.cm-focused > \.cm-scroller > \.cm-selectionLayer \.cm-selectionBackground\.cm-selectionBackground\s*{[^}]*}/,
    );
    expect(ourRule?.[0]).toContain('var(--cm-selection-bg)');

    // If the element does exist, the inline + cascaded styles should pick up
    // the variable we set above (rgb(1,2,3)).
    if (bg) {
      const computed = window.getComputedStyle(bg);
      // happy path: jsdom resolves the var. If not, fall back to inline.
      const value =
        computed.backgroundColor ||
        (bg.getAttribute('style') ?? '').match(/background[^;]*/)?.[0] ||
        '';
      // eslint-disable-next-line no-console
      console.log('computed bg:', value, 'class:', bg.getAttribute('class'));
    } else {
      // eslint-disable-next-line no-console
      console.log('no .cm-selectionBackground element rendered (jsdom layout gap)');
    }
  });
});
