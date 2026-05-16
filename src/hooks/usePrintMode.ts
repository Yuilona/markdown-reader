import { useEffect } from 'react';

/**
 * Print-mode body-class toggle (R11.x, PR-8).
 *
 * Window emits `beforeprint` before the print preview / dialog renders
 * and `afterprint` once the user closes the dialog (or the print
 * completes). We toggle `body.printing` so the @media print CSS rules
 * in `styles/print.css` can be paired with state-driven selectors
 * (e.g. `body.printing [data-print-hide] { display: none }`).
 *
 * Why the body class on top of @media print:
 *   - @media print alone is sufficient when the user prints from the
 *     OS dialog. But Tauri WebView2 supports `window.print()` from
 *     within the page, and we want the SAME hide rules to apply in
 *     both cases — the body class makes the gating explicit and lets
 *     us debug by simulating print mode (just toggle the class in
 *     DevTools).
 *
 *   - The data-print-hide attribute on individual components is the
 *     hook our hide rules target. Each tagged component "opts in" to
 *     being hidden during print. See:
 *       - Titlebar.tsx (the custom Win11 chrome)
 *       - Toc.tsx (the right-side sidebar)
 *       - SearchBar.tsx (the Ctrl+F overlay)
 *       - StatusBar.tsx (the bottom URL hover)
 *       - ToastContainer.tsx (the toast stack)
 *       - Mermaid.tsx (only the hover toolbar; the SVG itself prints)
 *
 * Edge case — late afterprint:
 *   Some browsers fire afterprint with a delay (or not at all if the
 *   user cancels via Esc during preview). The `printing` class will
 *   eventually be removed on the next print round-trip; for the
 *   visible app it doesn't matter — the rules are gated on @media
 *   print so nothing changes on screen even if the class lingers.
 */
export function usePrintMode(): void {
  useEffect(() => {
    const onBeforePrint = () => {
      document.body.classList.add('printing');
    };
    const onAfterPrint = () => {
      document.body.classList.remove('printing');
    };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);
}
