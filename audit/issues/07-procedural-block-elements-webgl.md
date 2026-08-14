Title: fix(browser): render U+2580–U+259F procedurally in WebGL

Follow-up to Hack 11's Canvas2D phase
(`washe/hack/11:hacks/11-render-neutral-block-element.md`, Phase B).

The WebGL painter still rasterizes Block Elements into its font atlas. That
leaves U+2580–U+259F dependent on font bearings and ink bounds, so repeated
halves, fractions, full blocks, shades, and quadrants can retain gaps or
filtered edge bleed after Canvas2D becomes render-neutral.

1. Consume the canonical 32-entry model from
   `packages/opentui-browser/src/block-elements.ts`.
2. Route U+2580–U+259F around the font-atlas result path using a per-instance
   render token plus cell-local coordinates. Procedural GLSL is preferred; an
   exact nearest-filtered mask texture is acceptable.
3. Generate the shader mapping from, or exhaustively verify it against, the
   canonical decoder. Do not maintain an unaudited second semantic table.
4. Preserve the text atlas, `CellGrid`, workers, and ANSI encoders unchanged.
5. Compare the shared 32-codepoint fixture with Canvas2D at odd cell sizes and
   fractional DPR. Hard edges have zero tolerance for missing pixels; shades
   retain 25/50/75 percent coverage.
6. Record repeated-block throughput against Hack 11's performance budget.

Canvas2D consumption is intentionally not blocked on this issue.
