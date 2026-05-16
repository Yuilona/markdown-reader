import { useEffect, useRef, useState } from 'react';
import { loadMermaid, setMermaidTheme } from '../../lib/mermaidLazy';
import { getCached, putCached } from '../../lib/mermaidCache';
import { useTheme } from '../ThemeProvider/useTheme';
import { MermaidToolbar } from './MermaidToolbar';
import styles from './Mermaid.module.css';

/**
 * PR-6: the mermaid theme name comes from the live theme context now.
 * `effective` is 'light' | 'dark'; map to Mermaid's palette keys
 * ('default' is the GitHub-light-equivalent, 'dark' is the dark one).
 *
 * The cache key includes this string (see `mermaidCache.ts`), so a
 * theme toggle finds no cache hit under the new key → mermaid.render()
 * runs and produces a fresh SVG in the new palette. The previous
 * theme's cache slice is cleared inside `setMermaidTheme()` (called
 * from ThemeProvider), so re-mounting an unchanged source under the
 * old theme would also miss its cache and re-render. Net effect:
 * theme toggle invalidates every visible Mermaid diagram correctly
 * without React having to do a key-driven remount dance at the
 * DocumentView level.
 */
function toMermaidThemeName(effective: 'light' | 'dark'): 'default' | 'dark' {
  return effective === 'dark' ? 'dark' : 'default';
}

interface MermaidProps {
  /** Raw Mermaid source (the contents of the ```mermaid fence). */
  source: string;
  /**
   * PR-4 will pass a real handler that clones the rendered SVG into a
   * portal-rendered lightbox. For PR-3 this is undefined and the
   * Fullscreen button is a no-op (with a debug log).
   */
  onRequestFullscreen?: (svg: string) => void;
}

type RenderState =
  | { kind: 'loading' }
  | { kind: 'rendered'; svg: string }
  | { kind: 'error'; message: string };

/**
 * Renders one Mermaid block as an interactive, pan/zoomable SVG.
 *
 * Render flow (R4.1, R4.4):
 *   1. On mount, look up `(source, theme)` in the module-scoped cache.
 *      Cache hit → instantly set rendered state.
 *   2. Cache miss → kick off `loadMermaid()` (lazy, ~4 MB chunk) and call
 *      `mermaid.render(id, source)` to produce an SVG string.
 *   3. Cache the result and switch state.
 *   4. After the SVG is in the DOM, attach `svg-pan-zoom`. We override
 *      its defaults to satisfy R4.2:
 *        - `mouseWheelZoomEnabled: false` so plain wheel scrolls the
 *          page; we add our own `wheel` listener that only zooms on
 *          Ctrl. This is the single most important UX rule for this
 *          component — DO NOT remove it without re-reading R4.2.
 *        - `dblClickZoomEnabled: false`; we add our own `dblclick`
 *          listener that calls `fit()` + `center()` to reset to fit-
 *          to-width (NOT zoom-in 2× as svg-pan-zoom does by default).
 *
 * Per-block error fallback (R4.5):
 *   Any throw from `mermaid.render()` is caught and shown as a red-
 *   bordered placeholder. Other Mermaid blocks in the same document
 *   keep rendering normally because each instance has its own
 *   try/catch in its own effect.
 *
 * Search exclusion (R4.6):
 *   The wrapper has `data-no-search` so PR-7's text-walker can prune
 *   this subtree before scanning for matches. KaTeX nodes will get the
 *   same treatment.
 */
export function Mermaid({ source, onRequestFullscreen }: MermaidProps) {
  // PR-6: subscribe to the app theme so the cache key + future re-renders
  // pick up the active palette. Reading at the top of render keeps the
  // value stable for THIS render pass; the cache-key dependency in the
  // effect below picks up theme changes between renders.
  const { effective } = useTheme();
  const mermaidTheme = toMermaidThemeName(effective);

  const [state, setState] = useState<RenderState>(() => {
    // Check cache synchronously — this lets a remount of an already-
    // rendered diagram (e.g. after a re-parse) skip the loading flash.
    const cached = getCached(source, mermaidTheme);
    return cached ? { kind: 'rendered', svg: cached } : { kind: 'loading' };
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  // We type the ref as `unknown` and cast at the use-site to avoid
  // pulling the whole `SvgPanZoom` namespace into module scope just for
  // a ref type. The instance carries enough self-describing methods that
  // JSDoc + the local cast keeps the surface clear.
  const panZoomRef = useRef<SvgPanZoom.Instance | null>(null);
  // Stash the manually-attached event-listener cleanup so the unmount
  // effect can run it before `panZoom.destroy()`.
  const customCleanupRef = useRef<(() => void) | null>(null);

  // ---- Step 1 + 2: render Mermaid SVG (cache → load → render → cache).
  // PR-6: depends on `mermaidTheme` too so theme toggles trigger a re-
  // render. The cache key includes theme, so toggling palette finds no
  // hit under the new key and produces a fresh SVG in matching colors.
  useEffect(() => {
    let cancelled = false;

    // Re-check cache: if the `source` prop or theme changed after mount,
    // this is the path that catches a hit and skips the async dance.
    const cached = getCached(source, mermaidTheme);
    if (cached) {
      // Bail with the existing state object when the lazy initializer
      // already populated us with the same SVG — avoids a wasted render
      // (and a wasted panZoom destroy/re-attach via the [state]-deps
      // effect) on the very first mount of a cached diagram.
      setState((prev) =>
        prev.kind === 'rendered' && prev.svg === cached
          ? prev
          : { kind: 'rendered', svg: cached },
      );
      return () => {
        cancelled = true;
      };
    }

    // Same bail trick as above for the cache-miss path: skip a wasted
    // render when the lazy initializer already put us in 'loading'.
    setState((prev) => (prev.kind === 'loading' ? prev : { kind: 'loading' }));

    (async () => {
      try {
        // Guarantee the Mermaid module's internal theme matches OUR React
        // cache key BEFORE rendering. ThemeProvider also calls this on
        // theme changes, but a first-mount race can race the provider's
        // async effect — calling it inline here makes Mermaid.tsx the
        // single source of truth for "the SVG paints in `mermaidTheme`".
        // `setMermaidTheme` is idempotent when the requested theme equals
        // the current one, so the overlap with ThemeProvider is free.
        await setMermaidTheme(mermaidTheme);
        const mermaid = (await loadMermaid()).default;
        // Mermaid requires a unique DOM id per render call. Random suffix
        // is enough — this id never reaches the document tree (we drop
        // the SVG into our own container via dangerouslySetInnerHTML).
        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, source);
        // Populate the cache even if the component unmounted mid-render.
        // The SVG is valid output; a subsequent remount of the same source
        // (e.g. after navigating away and back) deserves the cache hit.
        putCached(source, mermaidTheme, svg);
        if (cancelled) return;
        setState({ kind: 'rendered', svg });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, mermaidTheme]);

  // ---- Step 3: after the SVG is in the DOM, attach svg-pan-zoom.
  useEffect(() => {
    if (state.kind !== 'rendered') return;
    const container = containerRef.current;
    if (!container) return;
    const svg = container.querySelector<SVGSVGElement>('svg');
    if (!svg) return;

    // Mermaid's output sets explicit width/height (often a fractional
    // px value computed from its own layout pass). Stripping them lets
    // svg-pan-zoom take ownership of the viewBox math.
    //
    // We size the SVG element to fill its host container (.svgHost
    // is height: 100% inside a fixed-height .container). With
    // `fit: true, center: true` in svg-pan-zoom's options, this makes
    // the diagram scale UP to fill small natural sizes and DOWN to fit
    // oversized ones — predictable inline preview viewport.
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.maxWidth = '100%';
    svg.style.cursor = 'grab';

    let disposed = false;

    // Lazy-load svg-pan-zoom too. It's ~16 KB so the lazy-vs-static
    // decision is mild, but co-locating with mermaid's chunk keeps the
    // component's footprint off the main bundle entirely.
    void import('svg-pan-zoom').then((mod) => {
      if (disposed) return;
      const svgPanZoom = mod.default;
      const panZoom = svgPanZoom(svg, {
        // We draw our own toolbar; suppress the library's icons.
        controlIconsEnabled: false,
        zoomEnabled: true,
        panEnabled: true,
        // R4.2: own dblclick handler resets to fit; library's default
        // doubles the zoom which is the wrong interaction.
        dblClickZoomEnabled: false,
        // R4.2: own wheel handler so plain wheel scrolls the page.
        mouseWheelZoomEnabled: false,
        minZoom: 0.2,
        maxZoom: 5,
        zoomScaleSensitivity: 0.4,
        contain: false,
        fit: true,
        center: true,
      });
      panZoomRef.current = panZoom;

      // R4.2 wheel rule: ONLY zoom when Ctrl is held; otherwise let the
      // event bubble so the page scroll proceeds naturally. This is what
      // every "Mermaid renderer" the user has tried gets wrong.
      const wheelHandler = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.25 : 0.8;
        panZoom.zoomBy(delta);
      };

      // R4.2 dblclick rule: reset to fit-to-width + center (NOT zoom-in).
      const dblClickHandler = (e: MouseEvent) => {
        e.preventDefault();
        panZoom.fit();
        panZoom.center();
      };

      // Cursor swap during active drag — gives the proper "grabbing"
      // feedback while panning.
      const downHandler = () => {
        svg.style.cursor = 'grabbing';
      };
      const upHandler = () => {
        svg.style.cursor = 'grab';
      };

      // `passive: false` is required so `preventDefault()` actually
      // suppresses the browser's default Ctrl+wheel zoom.
      svg.addEventListener('wheel', wheelHandler, { passive: false });
      svg.addEventListener('dblclick', dblClickHandler);
      svg.addEventListener('mousedown', downHandler);
      // Listen on window for `up` so a drag that ends outside the SVG
      // still resets the cursor.
      window.addEventListener('mouseup', upHandler);

      customCleanupRef.current = () => {
        svg.removeEventListener('wheel', wheelHandler);
        svg.removeEventListener('dblclick', dblClickHandler);
        svg.removeEventListener('mousedown', downHandler);
        window.removeEventListener('mouseup', upHandler);
      };
    });

    return () => {
      disposed = true;
      customCleanupRef.current?.();
      customCleanupRef.current = null;
      const pz = panZoomRef.current;
      if (pz) {
        try {
          pz.destroy();
        } catch {
          // svg-pan-zoom can throw if the SVG was already detached;
          // safe to ignore — we just want all listeners gone.
        }
        panZoomRef.current = null;
      }
    };
    // We intentionally only re-run this effect when the rendered SVG
    // changes — the source-change path also bumps `state` because a
    // successful render produces a new `state.svg` value.
  }, [state]);

  // ---- Toolbar handlers (no-op when svg-pan-zoom hasn't attached yet).
  const handleZoomIn = () => panZoomRef.current?.zoomBy(1.25);
  const handleZoomOut = () => panZoomRef.current?.zoomBy(0.8);
  const handleReset = () => {
    const pz = panZoomRef.current;
    if (!pz) return;
    pz.fit();
    pz.center();
  };
  const handleFullscreen = () => {
    if (state.kind !== 'rendered') return;
    if (onRequestFullscreen) {
      onRequestFullscreen(state.svg);
    } else {
      // PR-4 will replace this with the lightbox open call.
      // eslint-disable-next-line no-console
      console.log('[markdown-reader] fullscreen requested — implemented in PR-4');
    }
  };

  // ---- Loading skeleton (R4.1).
  if (state.kind === 'loading') {
    return (
      <div
        className={`${styles.container} ${styles.skeleton}`}
        data-no-search
        aria-busy="true"
        aria-label="加载 Mermaid 图…"
      >
        <div className={styles.skeletonBar} />
      </div>
    );
  }

  // ---- Per-block error fallback (R4.5).
  if (state.kind === 'error') {
    return (
      <div className={`${styles.container} ${styles.error}`} data-no-search>
        <div className={styles.errorTitle}>Mermaid 渲染失败</div>
        <pre className={styles.errorMessage}>{state.message}</pre>
        <details>
          <summary>查看源代码</summary>
          <pre className={styles.errorSource}>
            <code>{source}</code>
          </pre>
        </details>
      </div>
    );
  }

  // ---- Rendered SVG + toolbar.
  // `dangerouslySetInnerHTML` is acceptable here because the SVG comes
  // from Mermaid with `securityLevel: 'strict'` (no inline JS, no raw
  // user HTML). Using innerHTML is the supported integration path.
  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-no-search
    >
      <div className={styles.svgHost} dangerouslySetInnerHTML={{ __html: state.svg }} />
      <MermaidToolbar
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
        onFullscreen={handleFullscreen}
      />
    </div>
  );
}
