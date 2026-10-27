# Patch 14: merge Canvas2D background runs

Part of indexzero/charlie.dev#567, on top of patch 13. The painter joins
adjacent opaque backgrounds with equal quantized RGB and equal vertical
geometry. It formats their color once and submits one fill for the run.
A uniform 48 by 49 grid needs 49 cell-background fills instead of 2,352.

Background rectangles share rounded device-pixel boundaries, matching the
procedural block renderer. Both ends are rounded independently from absolute
cell positions; widths are their difference, so rounding cannot accumulate
across a row. The actual backing-store/CSS ratio is used on each axis,
including when resize rounding makes that ratio differ from devicePixelRatio.
Opaque runs can merge at fractional zoom as well as integer scales.

Translucent backgrounds remain individual fills, using the same shared edges
to avoid gaps and double compositing. Layered block elements, transparent
cells, color changes, and different bottom-flush geometry break runs. The
last cell still extends to the viewport edge. All backgrounds precede all
glyphs. Glyph origins, color values, block painting, decorations, and layer
order are unchanged.

## Fractional zoom correction

The initial patch merged only rectangles with device-aligned edges. Its
fallback preserved the older per-cell renderer's antialiased seams at
fractional scales, visible on selection backgrounds at 90% and 110% zoom.
Pixel equality with that renderer did not prove a uniform background stayed
uniform. The follow-up deliberately moves fractional background edges by at
most half a device pixel, removing those seams. Already aligned edges keep
their original coordinates.

## Validation

Unit tests cover draw counts, quantized color equality, transparent gaps,
fractional scales, alpha, shared edges, viewport remainders, bottom-flush
cells, and wide/decorated glyph ordering. All 49 tests and the separate
browser/test TypeScript checks pass.

The consumer's real-canvas harness checks uniform coverage against a single
full-canvas fill, rather than relying only on equality with the old painter.
All 72 cases pass in Chromium and WebKit: nine scales from 0.9 through 3,
opaque and half-transparent backgrounds, and ordinary cells interleaved
with procedural blocks. The corrected anthology selection is uniform in
12 page cases across both engines, with identical recorded glyph geometry
before and after. All 28 existing browser glyph-alignment checks also pass.
Scripts, screenshots, and raw results live in charlie.dev's `sslop/perf`.
