# Patch 12: measured Canvas2D text alignment

Fixes indexzero/charlie.dev#677. The previous middle alignment centered the
nominal font-size box. With `textBaseline = 'top'`, WebKit places Geist Mono's
baseline about five CSS pixels lower than Chromium, so selected text touched
the bottom of its highlight even with middle alignment enabled.

The painter now measures `Mg` once for the configured font. Its signed ascent
and descent describe the visible reference envelope relative to the actual
Canvas top anchor. Middle alignment uses:

```ts
Math.round((paintedCellHeight + ascent - descent) / 2)
```

Bottom alignment uses `paintedCellHeight - descent`. Every glyph and style
shares that font reference; measuring individual glyphs would make their
baselines jump. Rounding the final draw anchor preserves the existing Chromium
raster at the default font sizes while correcting WebKit's anchor difference.

Cell dimensions remain unchanged. The last row still accounts for its stretched
height, and bottom-flush cells retain their natural height. Top alignment and
missing-metric fallback retain their previous behavior. Procedural Block
Elements continue to use cell geometry. Underline and strike positions follow
the text offset; underline clamping occurs after alignment.

`canvas-painter-alignment.test.ts` covers different engine anchors, shared
baselines, real Geist metric samples, fallback, last-row geometry, decorations,
and procedural blocks. The consuming washe app runs actual canvas pixel
assertions in Chromium and WebKit at DPR 1 and 2, including font and size changes.

This patch is for Canvas2D. GL/GPU parity remains tracked by charlie.dev#626.
