Title: fix(browser): glyph-atlas baseline parity — self-calibrate atlas cell placement (GL/GPU)

From the 2026-07-28 browser-compat audit (`audit/BROWSER.AUDIT.md`, finding
**F3**).

The GL and GPU painters rasterize glyphs into their atlases at
`textBaseline:'top'`-anchored cell origins (`canvas-gl-painter.ts:216`,
`canvas-gpu-painter.ts:242`). Per-engine ascent differences therefore shift
glyphs *within* atlas cells — the same divergence class fixed for the 2D
painter's decoration rules on `washe/hack/08`, imported wholesale into the
accelerated paths.

1. Apply the same `actualBoundingBox*` self-calibration to atlas cell
   placement so glyphs sit at the engine-measured baseline within each
   atlas cell.
2. Note: the GL painter draws no underline/strike rules (atlas-only), so
   this is purely glyph placement — but verify the GPU painter's decoration
   handling while in there.
3. Verification: the engine-relative invariant tests from issue 01 extended
   to the GL/GPU painters, plus the WebKit smoke.

Severity re-grades to High for any embedder that defaults to the GL/GPU
painters (the known primary embedder defaults to 2D today).
