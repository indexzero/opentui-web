Title: fix(browser): re-derive DPR-dependent sizes on zoom/display change (GL/GPU)

From the 2026-07-28 browser-compat audit (`audit/BROWSER.AUDIT.md`, finding
**F6**).

The GL and GPU painters snapshot `window.devicePixelRatio` at init
(`canvas-gl-painter.ts:121`, `canvas-gpu-painter.ts:121`). A mid-session
zoom change or a window move across displays with different scale factors
leaves atlas/cell pixel sizes derived from a stale DPR until a full
rebuild — and engines rasterize fractional-zoom canvases differently, so
the degraded state is engine-dependent too.

1. Re-measure on the standard signal:
   `matchMedia('(resolution: …dppx)')` change listener (the
   devicePixelRatio-change detection pattern), or an explicit
   `setViewport`-style entry point like the 2D painter's.
2. Rebuild the atlas and re-derive cell pixel sizes when DPR changes.
3. Test: mock a DPR change; assert atlas/cell sizes re-derive.

Low severity (rare state — rubric 2×2×1) but cheap to close.
