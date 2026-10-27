# Patch 14: merge eligible Canvas2D background runs

Part of indexzero/charlie.dev#567, on top of patch 13. The painter now joins
adjacent opaque backgrounds with equal quantized RGB and equal vertical
geometry. It formats their color once and submits one fill for the run.
A uniform 48 by 49 grid needs 49 cell-background fills instead of 2,352.

Merging is limited to rectangles whose edges map exactly to device pixels.
Fractional edges retain per-cell painting because removing an antialiased
internal edge can change compositing. Translucent backgrounds also retain
per-cell painting. Layered block elements, transparent cells, color changes,
and different bottom-flush geometry break runs. The last cell still extends
to the viewport edge. All backgrounds still precede all glyphs; this patch
does not combine passes or change block, glyph, or decoration painting.

Unit tests cover draw counts, quantized color equality, gaps, fractional
scales, alpha, edge remainders, bottom-flush cells, and wide/decorated glyph
ordering. The consumer's performance harness compares actual backing-store
pixels with patch 12 in Chromium and WebKit across three fonts, multiple
viewport sizes, DPR 1 through 3 including fractional ratios, and both paint
modes. The scripts and raw results live in charlie.dev's local `sslop/perf`;
the consuming PR records the measured results and integration checks.
