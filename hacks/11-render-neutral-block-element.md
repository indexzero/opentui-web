# Hack 11: render-neutral Unicode Block Elements

| Field | Value |
| --- | --- |
| Status | Proposed; implementation has not started |
| Planned branch | `washe/hack/11` |
| Depends on | `washe/hack/10` (`paintOver` and background-alpha compositing) |
| Origin | Washe issue #560, shared half-cell padding around picker selection bands |
| Scope | `opentui-browser` direct cell-grid painters; Washe cleanup after the fork lands |
| Primary owner | The `opentui-web` fork, not an individual Washe call site |
| Last reviewed | 2026-08-14 |
| Decision | Decode U+2580–U+259F as render-neutral coverage and lower it procedurally in direct painters |

> This is the first hack document. It is intentionally more explicit than a
> normal implementation plan so it can serve as the exemplar for back-filling
> Hacks 01–10. The final section identifies the reusable structure and the
> evidence every future hack record should preserve.

## Executive decision

Washe should continue to express a half-cell as the ordinary terminal idiom:

```text
U+2580 UPPER HALF BLOCK + foreground + background
```

No Washe-specific half-rectangle API and no new field in `CellGrid` are needed.
The cell already carries all of the information required to reconstruct the
intended image. The defect is that the direct browser painters currently pass
Block Elements through a font rasterizer, although these characters encode
cell-relative coverage.

Hack 11 will:

1. Add one canonical, renderer-neutral decoder for the complete Unicode Block
   Elements range U+2580–U+259F.
2. Make `CanvasPainter` use exact cell geometry or coverage for that range,
   bypassing `fillText`.
3. Give `paintOver` explicit two-colour layer compositing for Block Elements so
   a transparent half leaves the previously painted substrate untouched.
4. Preserve ordinary font rendering for every other codepoint.
5. Define, test, and stage equivalent GL and GPU lowering without changing the
   `CellGrid` wire format or the ANSI paths.
6. Remove Washe's font-dependent and forced-opaque padding workaround after the
   forked painter is verified.

This is a backend-correctness change within this fork's direct-painter contract.
It is not a Yoga layout change, an OpenTUI core API change, or a picker-only
special case.

## Why this record exists

The visible failure appeared in Washe's anthology picker at a 650 CSS-pixel
viewport. A selected row used `▀` to share one cell row between the bottom
padding of the item above and the top padding of the item below. The output had
three symptoms:

- teeth along horizontal colour boundaries because the font glyph did not fill
  the whole cell advance;
- a vertically asymmetric split because the font's ink was not exactly half the
  cell box;
- an opaque black bar where a sampled transparent foreground had been promoted
  to opaque black to compensate for the background-first painter.

The first attempted reasoning measured a particular font's ink and chose between
`▀` and `▄`. That made application logic depend on font metrics and did not
generalize across fonts, engines, device-pixel ratios, or painters. The durable
question is not which font glyph happens to touch an edge. It is whether a
direct terminal-cell renderer should reconstruct the coverage encoded by a
Block Element.

The answer for this fork is yes.

## Evidence chain

### 1. Yoga establishes whole-cell layout, not sub-cell rasterization

The vendored OpenTUI renderer configures Yoga with
[`setPointScaleFactor(1)`](../packages/opentui/packages/core/src/Renderable.ts#L199-L202).
Yoga rounds final layout results to its configured pixel grid; with OpenTUI's
coordinate system, one Yoga point is one terminal cell. The underlying rounding
is implemented in Yoga's
[`PixelGrid.cpp`](https://github.com/react/yoga/blob/main/yoga/algorithm/PixelGrid.cpp).

OpenTUI's public
[`fillRect`](../packages/opentui/packages/core/src/buffer.ts#L290-L292) and
[`drawBox`](../packages/opentui/packages/core/src/buffer.ts#L433-L490) therefore
address whole cells. This explains why there is no `fillHalfCell` next to those
methods. It does **not** determine how a codepoint is rasterized inside a cell.

Hack 11 must not alter Yoga configuration, computed layout coordinates, picker
row allocation, or the whole-cell `fillRect` API.

### 2. Richer drawing APIs are possible, but OpenTUI lowers them to cells

It would be too strong to claim that a portable sub-cell API cannot exist.
OpenTUI already exposes
[`drawSuperSampleBuffer`](../packages/opentui/packages/core/src/buffer.ts#L347-L365):
callers provide 2×2 pixels per terminal cell, and the Zig core lowers those
pixels to a codepoint plus foreground and background colours.

The lowering is explicit in
[`drawSuperSampleBuffer`](../packages/opentui/packages/core/src/zig/buffer.zig#L1877-L1921),
and its table selects the sixteen space, half-block, and quadrant results in
[`quadrantChars`](../packages/opentui/packages/core/src/zig/buffer.zig#L2159-L2176).
The resulting cell is written with
[`setCellWithAlphaBlending`](../packages/opentui/packages/core/src/zig/buffer.zig#L1918-L1920).

This establishes two distinct abstraction boundaries:

```text
higher-level pixels or layout
        ↓ OpenTUI lowering
codepoint + foreground + background + attributes
        ↓ backend rasterization
device pixels
```

A higher-level pixel primitive may be portable because an ANSI implementation
can approximate it with Block Elements. Once OpenTUI has lowered the operation,
however, this fork's painters receive only a cell. At that boundary, `▀ + fg +
bg` is the available render-neutral representation.

Adding another `CellGrid` field would duplicate information and would not repair
existing OpenTUI operations that already produce Block Elements.

### 3. `CellGrid` deliberately preserves the terminal-cell boundary

The browser wire format contains only dimensions, codepoints, foreground RGBA,
background RGBA, and attributes:
[`CellGrid`](../packages/opentui-browser/src/cell-grid.ts#L10-L17).
The browser buffer likewise exposes
[`setCell(x, y, char, fg, bg, attributes)`](../packages/opentui-browser/src/buffer.ts#L78-L82).

The same grid feeds workers and all three direct painters. Keeping it unchanged
has concrete benefits:

- worker messages do not grow;
- ANSI and direct paths continue to begin from the same state;
- existing OpenTUI supersampling output is fixed automatically;
- applications do not need to know which backend will paint the cell;
- copy-as-text retains the actual Unicode character.

The canonical Block Elements decoder therefore belongs after `CellGrid`, inside
the direct rendering layer.

### 4. Every direct painter currently delegates Block Elements to a font

`CanvasPainter` first fills every cell's full background and later draws every
non-space character with
[`ctx.fillText`](../packages/opentui-browser/src/canvas-painter.ts#L235-L338).
The horizontal teeth and asymmetric split are expected consequences: Canvas text
painting renders a font glyph at an origin; it does not promise that the glyph's
ink equals the terminal cell rectangle. The HTML Canvas specification defines
[`fillText`](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-filltext-dev)
as text rendering and
[`fillRect`](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-fillrect)
as geometric rectangle rendering. They are different operations.

The GPU painters inherit the same dependency in a less obvious place. Their
atlases include U+2500–U+259F, but atlas construction still calls `fillText`:

- [WebGL glyph set and atlas construction](../packages/opentui-browser/src/canvas-gl-painter.ts#L84-L95)
  and [font draw](../packages/opentui-browser/src/canvas-gl-painter.ts#L186-L217);
- [WebGPU glyph set](../packages/opentui-browser/src/canvas-gpu-painter.ts#L82-L91)
  and [font draw](../packages/opentui-browser/src/canvas-gpu-painter.ts#L213-L244).

The README already records block-character gaps as a known direct-GPU defect
and identifies untextured geometry as one possible repair:
[`README.md`](../README.md#visual-artefacts-on-the-webgl--webgpu-variants).

Hack 11 is therefore not introducing a new quality bar. It is implementing a
known missing part of the direct painters.

### 5. Native Ghostty treats the range as procedural terminal graphics

Native Ghostty is the strongest implementation reference available in the
current stack. Its built-in sprite face dispatches every codepoint from
U+2580 through U+259F and maps them to cell-relative blocks, shades, or
quadrants:

- [complete codepoint dispatch](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/font/sprite/draw/block.zig#L30-L108);
- [cell-relative rectangle calculation](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/font/sprite/draw/block.zig#L121-L152);
- [quadrant construction](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/font/sprite/draw/block.zig#L168-L176);
- [shade coverage values](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/font/sprite/draw/common.zig#L42-L51).

This is a reference, not proof of a universal terminal-emulator requirement.
Unicode assigns character identities and representative coverage; it does not
require every renderer to ignore fonts. The contract adopted here is narrower:
the direct painters promise font-independent, seamless terminal graphics for
this range.

### 6. ghostty-web does not inherit Ghostty's native sprite renderer

The `ghostty` variants travel through ANSI to ghostty-web, while the direct
painters bypass that pipeline entirely. More importantly, current ghostty-web
uses Ghostty's WASM terminal state with its own TypeScript Canvas renderer. That
renderer obtains a codepoint or grapheme and calls
[`fillText`](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/renderer.ts#L637-L650).

Consequences:

- fixing `CanvasPainter` cannot change the ghostty-web variant;
- using ghostty-web does not automatically reuse native Ghostty's Block Element
  sprite implementation;
- any ghostty-web discrepancy should be reported or fixed upstream separately;
- Hack 11 must not intercept or rewrite the ANSI stream to compensate.

### 7. Unicode supplies the semantic table

The Unicode Block Elements chart defines the range:

- U+2580–U+2590 and U+2594–U+2595 are fractional blocks;
- U+2591, U+2592, and U+2593 are 25%, 50%, and 75% shade;
- U+2596–U+259F select explicit quadrants.

The authoritative names and coverage notes are in the
[`Block Elements` names list](https://www.unicode.org/charts/nameslist/n_2580.html)
and the corresponding
[`U+2580 code chart`](https://www.unicode.org/charts/PDF/U2580.pdf).

Those fractions, rather than observed glyph ink, are the canonical input to the
decoder.

## Decision and invariants

### Decision

Create a module such as
`packages/opentui-browser/src/block-elements.ts` that recognizes U+2580–U+259F
and returns a renderer-neutral coverage description. Direct painters consult it
before their ordinary glyph path.

### Required invariants

1. **No application special case.** Washe emits the same codepoint and colours
   it would emit to a terminal.
2. **No wire-format change.** `CellGrid` remains codepoint + fg + bg + attrs.
3. **Complete range.** The decoder covers all 32 assigned codepoints from
   U+2580 through U+259F, not only `▀`.
4. **Font independence.** Once a codepoint is recognized, no font selection,
   `measureText`, `fillText`, side bearing, baseline, or glyph atlas determines
   its coverage.
5. **No cracks.** Adjacent blocks sharing an edge leave no transparent or
   background-coloured device pixels between them.
6. **Exact outer bounds.** A full block reaches all four cell edges. Fractional
   blocks and quadrants reach every edge named by their Unicode identity.
7. **Deterministic rounding.** Odd cell dimensions and fractional DPR use shared
   absolute edges, never separately rounded widths that can create gaps.
8. **Alpha is mode-aware.** `paint()` preserves its opaque-frame behavior;
   `paintOver()` treats foreground and background regions as independent layer
   contributions so transparent regions reveal the substrate.
9. **Text remains text.** Codepoints outside U+2580–U+259F retain the current
   font-rendering and decoration paths.
10. **ANSI remains ANSI.** ghostty-web and xterm.js variants continue to receive
    unmodified codepoints and SGR colours.
11. **Workers are equivalent.** A transferred `CellGrid` paints identically to a
    snapshot backed directly by WASM memory.
12. **No hidden font fallback.** Unsupported direct-backend work is explicit in
    status/tests; it must not silently fall back to font glyphs while claiming
    procedural support.

## Render-neutral semantic model

### Proposed API shape

The exact TypeScript names may change during implementation, but the module
should expose data rather than Canvas calls:

```ts
export interface UnitRect {
  x0: number // inclusive, normalized 0..1
  y0: number
  x1: number // exclusive, normalized 0..1
  y1: number
}

export type BlockElementMask =
  | { kind: 'binary'; foreground: readonly UnitRect[] }
  | { kind: 'uniform'; coverage: 0.25 | 0.5 | 0.75 }

export function decodeBlockElement(codepoint: number): BlockElementMask | null
```

`binary` means each point in the cell belongs either to foreground or to the
background complement. `uniform` is the shade-mask case: the foreground has a
constant coverage over the cell. The decoder knows nothing about CSS pixels,
DPR, Canvas, shaders, atlases, fonts, or RGBA compositing.

The data should be static and allocation-free in paint loops. Return shared
frozen descriptors or encode the result into compact constants; do not allocate
rectangle arrays per cell.

### Canonical mapping

| Range | Meaning | Normalized foreground coverage |
| --- | --- | --- |
| U+2580 | Upper half | `x=[0,1], y=[0,1/2]` |
| U+2581–U+2587 | Lower 1/8 through 7/8 | bottom-aligned `n/8` rectangle |
| U+2588 | Full block | entire cell |
| U+2589–U+258F | Left 7/8 through 1/8 | left-aligned `n/8` rectangle |
| U+2590 | Right half | `x=[1/2,1], y=[0,1]` |
| U+2591–U+2593 | Light/medium/dark shade | uniform `1/4`, `1/2`, `3/4` coverage |
| U+2594 | Upper 1/8 | top-aligned 1/8 rectangle |
| U+2595 | Right 1/8 | right-aligned 1/8 rectangle |
| U+2596–U+259F | Named quadrants | union of named 1/2 × 1/2 rectangles |

The unit tests must enumerate each codepoint individually even if production
code derives several ranges arithmetically. Range arithmetic is compact; an
explicit expected table is easier to audit against Unicode and Ghostty.

### Shade interpretation

Use semantic coverage values `0.25`, `0.5`, and `0.75`. An 8-bit mask may
quantize these to 0x40, 0x80, and 0xC0, matching Ghostty's representation. Do
not render the shade characters using whatever stipple happens to exist in the
active font.

Uniform coverage is the initial decision because it:

- agrees with Ghostty's grayscale sprite masks;
- preserves the documented 25/50/75 percent density;
- scales without moire at arbitrary DPR;
- composes predictably when foreground or background is transparent.

An ordered-dither presentation could be added later as a separately named
style, but it must not be an accidental by-product of a selected font.

## Colour and alpha model

### Why the ordinary background-first path is insufficient

The current Canvas2D loop paints the background across the entire cell and then
draws a glyph over it. That is correct for ordinary opaque terminal text. It is
also why a naive foreground `fillRect` does not repair Washe's black bar: by the
time the foreground is considered, the background has already covered the part
of the substrate that a transparent half was meant to reveal.

Hack 10 introduced two intentionally different modes:

- `paint()` clears and paints a complete opaque frame;
- `paintOver()` composites a transparent content buffer over an existing
  substrate and honors background alpha.

Hack 11 must preserve that distinction.

### `paint()` semantics

For the ordinary full-frame path, preserve the existing background-under-glyph
model:

1. paint the cell background as today;
2. paint the procedural foreground coverage over it, honoring foreground alpha;
3. skip `fillText` for the recognized Block Element.

This fixes font-dependent geometry without broadening Hack 11 into a rewrite of
the established opaque painter's alpha behavior.

An optimized implementation may combine the operations, but its pixels must be
equivalent to background-first source-over compositing.

### `paintOver()` semantics

For a layered content buffer, a Block Element is a partition between two source
colours. The background must **not** be painted beneath foreground-covered
regions.

For binary masks:

- foreground rectangles source-over with `fg`;
- the exact complement source-overs with `bg`;
- a region whose selected colour has alpha zero performs no draw and leaves the
  substrate untouched.

For a shade with coverage `m`, treat foreground and background as coverage
alternatives. Given unpremultiplied colours `F` and `B`, construct a source in
premultiplied form:

```text
sourceAlpha = m * F.a + (1 - m) * B.a
sourceRGBpremul = m * F.a * F.rgb + (1 - m) * B.a * B.rgb
```

Then source-over that result onto the existing canvas. If `sourceAlpha` is zero,
draw nothing. Otherwise convert the premultiplied RGB back to the RGBA form
expected by Canvas before filling.

This has the desired limiting cases:

- opaque `F` and `B`: ordinary interpolation between the two colours;
- transparent `B`, opaque `F`: `F` covers the substrate by 25/50/75 percent;
- transparent `F`, opaque `B`: the complementary share is `B`;
- both transparent: the substrate is unchanged.

This mode-specific behavior is deliberate. Alpha-bearing terminal cells are an
extension used by this fork's layer compositor, not an ANSI terminal standard.
The document and tests must state the extension instead of implying that every
terminal defines transparent foreground/background partitions.

## Device-pixel geometry

Normalized fractions alone do not prevent seams if each rectangle rounds its
origin and width independently. Each backend must derive all rectangles from
shared absolute cell edges.

For Canvas2D, retain the measured CSS-to-device scale from `setViewport` and
derive device edges conceptually as:

```text
left   = round((cellX + x0) * cellWidth  * scaleX)
right  = round((cellX + x1) * cellWidth  * scaleX)
top    = round((cellY + y0) * cellHeight * scaleY)
bottom = round((cellY + y1) * cellHeight * scaleY)
```

Paint `[left,right) × [top,bottom)` in device space. Adjacent regions reuse the
same computed boundary, so an odd-height cell may allocate the unavoidable
extra pixel to one side but can never leave a missing row or draw overlapping
semi-transparent edges.

Requirements:

- round absolute edges, not `round(width * fraction)` followed by addition;
- use half-open rectangles in helpers and tests;
- keep last-row `FLUSH_BOTTOM` and stretched-row offsets in the cell-origin
  calculation before applying mask fractions;
- preserve full-bleed final-column/final-row behavior where the existing painter
  expands a cell to the measured CSS viewport edge;
- never use text antialiasing or `fillText` in the recognized path.

The implementation may keep Canvas coordinates in CSS space if browser pixel
tests prove identical coverage at fractional scales. Device-space edges are the
reference behavior when CSS-space rasterization disagrees.

## Backend plan

### Phase A: canonical decoder and Canvas2D

This is the first landing target because it fixes the Washe production path and
establishes executable semantics for later painters.

1. Add `block-elements.ts` with the complete mapping and coverage helpers.
2. Add allocation-free decoder unit tests for all 32 codepoints.
3. Refactor `CanvasPainter.paintCells` so each cell is classified once as text,
   space/decorations, or Block Element.
4. In the background pass:
   - `paint()`: retain the existing full background fill;
   - `paintOver()`: skip the ordinary full-cell background for recognized Block
     Elements because the procedural pass owns both fg and bg coverage.
5. In the character pass, route recognized codepoints to a dedicated block
   painter before font selection and `fillText`.
6. Preserve underline and strikethrough behavior after the block draw. A Block
   Element with decoration attributes is unusual but should remain deterministic.
7. Add a development fixture containing every codepoint, adjacency stress rows,
   odd-sized cells, transparent combinations, and a checkerboard substrate.
8. Add browser pixel tests described below.

The Canvas2D landing is complete only when the Washe case works with the forced
foreground-alpha workaround removed.

### Phase B: WebGL2

Do not continue putting Block Elements into the font atlas. Preserve the atlas
for text and box-drawing characters, but classify U+2580–U+259F as procedural.

The preferred implementation is a procedural mask path in the fragment shader:

1. Encode a render token per instance: ordinary atlas glyph, background-only,
   or Block Element index 0–31.
2. Pass cell-local coordinates separately from atlas UVs.
3. Generate the GLSL Block Element mask logic from the canonical TypeScript
   mapping at build time, or verify a compact shader mapping against the same
   exhaustive expected table. Do not maintain an unaudited hand-written second
   semantic table.
4. For a Block Element, compute coverage from local coordinates and return
   `mix(bg, fg, coverage)` for the current opaque WebGL surface.
5. Do not sample the text atlas in the Block Element result path except where
   WebGL control-flow constraints require a harmless eager sample.
6. Benchmark repeated `▀` plasma before and after; the procedural branch must not
   regress frame throughput beyond the threshold in the performance section.

An alternative small nearest-filtered mask texture generated from the canonical
decoder is acceptable if it proves simpler and faster. Reusing the existing
linearly filtered, unpadded text atlas is not acceptable because it retains the
edge-bleed mechanism Hack 11 is meant to remove.

### Phase C: WebGPU

Mirror the WebGL render-token and cell-local-mask design in WGSL. The current
shader samples the atlas before branching because `textureSample` requires
uniform control flow; that eager sample may remain. The Block Element result
must nevertheless come from procedural coverage rather than the sampled font
mask.

Keep the GLSL and WGSL implementations generated from, or exhaustively checked
against, the same canonical 32-entry model. Backend parity tests should render
the identical `CellGrid` fixture through Canvas2D, WebGL2, and WebGPU and compare
semantic regions with a small colour tolerance only where GPU colour conversion
requires it. Hard block edges themselves have zero tolerance for holes.

### ANSI-mediated backends

No code change is planned for `ansi.ts`, ghostty-web integration, xterm.js
integration, full encoding, or diff encoding. These paths continue to serialize
the same Unicode codepoint and colours.

Add the all-Block-Elements fixture to the comparison lab so differences are
visible. If ghostty-web continues to show font-dependent gaps, open a focused
upstream issue or patch against its TypeScript renderer using native Ghostty's
sprite code as prior art. Do not make Hack 11 depend on that upstream change.

## File-by-file implementation plan

### New files

`packages/opentui-browser/src/block-elements.ts`

- canonical range check and mapping;
- normalized binary rectangles and uniform shade coverage;
- allocation-free shared descriptors;
- helpers needed for tests or shader generation;
- no browser globals and no renderer imports.

`packages/opentui-browser/src/block-elements.test.ts`

- explicit expected descriptor for all 32 codepoints;
- null outside the range, including U+257F and U+25A0;
- mirror/complement invariants;
- exact shade values;
- immutability/allocation expectations if encoded in the API.

`packages/web-demo/src/routes/block-elements.tsx` or an equivalent fixture

- complete 32-character table;
- repeated seamless bands;
- all fg/bg alpha combinations over a visible substrate;
- odd/even viewport and DPR controls;
- renderer picker using the existing comparison harness.

Browser pixel-test files and golden assets should live under a clearly named
`packages/web-demo/e2e` or `packages/opentui-browser/e2e` tree. Do not hide
renderer conformance in Washe's application-only suite.

### Modified files

`packages/opentui-browser/src/canvas-painter.ts`

- recognize Block Elements before ordinary background/glyph handling;
- procedural opaque and layered compositing paths;
- shared device-edge rounding helper;
- no `fillText` for U+2580–U+259F;
- retain decorations, vertical alignment, last-row stretch, and `FLUSH_BOTTOM`.

`packages/opentui-browser/src/canvas-gl-painter.ts`

- remove Block Elements from font-atlas dependence;
- add procedural render token/mask path;
- preserve text atlas behavior for other codepoints.

`packages/opentui-browser/src/canvas-gpu-painter.ts`

- same contract as WebGL in WGSL;
- preserve eager atlas sampling if required for shader validation.

`packages/opentui-browser/src/index.ts`

- export the decoder only if it is intentionally public. The default is to keep
  it internal until a second consumer outside the painters appears.

`README.md`

- replace the Block-character gaps limitation after all direct GPU painters
  conform;
- while only Canvas2D is complete, record the staged support matrix explicitly;
- link this hack record from the relevant limitation or a new Hacks section.

### Washe follow-up after the fork lands

On the consuming Washe change:

1. advance vendoring to `washe/hack/11` through the established vendor script;
2. restore `paintPaddingRow` to `fg = above ?? bgAt(...)`, preserving sampled
   alpha instead of copying RGB and forcing alpha to one;
3. delete the font-measurement claim that `▀` inks only offsets 0–10 and `▄`
   stops short of the cell bottom;
4. keep the render-neutral statement: `▀` selects top foreground and bottom
   background;
5. update picker tests so a sampled transparent foreground remains transparent;
6. keep the existing one-row layout and `fg=above, bg=below` cell contract;
7. run the real localStorage-seeded font and width sweep, not only buffer-call
   unit tests;
8. remove temporary screenshot/sweep scripts only if they are superseded by a
   checked-in conformance harness and separately confirmed as disposable.

The Washe cleanup is evidence that the fork fix is sufficient. It must not land
first and temporarily reintroduce the black bar against Hack 10.

## Verification strategy

### Decoder unit tests

The semantic tests are pure and fast. They must verify:

- U+2580 is exactly the top half;
- U+2581–U+2587 monotonically add lower eighths;
- U+2589–U+258F monotonically remove left eighths;
- U+2588 is full coverage;
- U+2590 and U+258C are horizontal mirrors;
- U+2594 and U+2581 are top/bottom eighth mirrors;
- U+2595 and U+258F are right/left eighth mirrors;
- shades are exactly 1/4, 1/2, and 3/4 semantically;
- every quadrant codepoint selects exactly the named quadrants;
- decoder returns `null` for every sampled non-Block-Element neighbor.

Do not assert only that a Canvas call occurred. The expected coverage table is
the contract.

### Canvas2D operation tests

With a recording 2D context, verify control flow:

- recognized characters never call `fillText`;
- ordinary characters still call `fillText` once;
- `paint()` retains a full background operation;
- `paintOver()` omits the full background for recognized Block Elements;
- transparent binary regions issue no fill;
- shades issue the computed coverage colour/alpha;
- underline and strikethrough still occur at their measured offsets;
- last-row and `FLUSH_BOTTOM` origins feed the procedural geometry.

These tests guard architecture, not pixels, and therefore cannot be the final
acceptance layer.

### Pixel conformance tests

Use a real browser canvas and inspect pixel output. At minimum cover:

| Dimension | Values |
| --- | --- |
| Browser engine | Chromium and WebKit required; Firefox desirable |
| DPR / scale | 1, 1.25, 1.5, 2 |
| Cell width | odd and even |
| Cell height | odd and even |
| Font | Fragment Mono, Geist Mono, system monospace |
| Painter | Canvas2D; then WebGL2 and WebGPU as their phases land |
| Input source | direct WASM snapshot and transferred worker `CellGrid` |
| Paint mode | opaque `paint`; Canvas2D layered `paintOver` |
| Alpha | fg/bg 0, 0.5, and 1 in representative combinations |
| Layout edge | interior, last column, stretched last row, `FLUSH_BOTTOM` row |

Required assertions:

- repeated `▀` cells form a continuous top band with no teeth;
- top and bottom regions cover the entire cell exactly once in layered opaque
  tests;
- transparent top over checkerboard preserves the exact checkerboard pixels;
- transparent bottom behaves symmetrically with `▄`;
- full block has no inset on any edge;
- eighth blocks meet expected rounded absolute boundaries;
- quadrant mosaics have no central cross-shaped seam;
- changing fonts may change cell metrics but not normalized block coverage;
- resizing through a width sweep does not produce transient cracks.

For hard edges, pixel comparisons should use exact expected colours. A broad
screenshot percentage or perceptual-diff threshold can hide the one-pixel seam
this hack exists to eliminate.

### Cross-backend comparison

The comparison fixture should make two kinds of result visible:

1. **Semantic parity:** the selected fractions/quadrants and colours agree.
2. **Backend ownership:** direct painters are procedural; ANSI-mediated output
   remains whatever the selected terminal emulator produces.

Do not require byte-identical antialiasing for ordinary text. For Block Elements,
compare region classifications and edge continuity. Canvas2D, WebGL2, and WebGPU
should agree exactly after all three phases land.

### Washe acceptance sweep

The originating application must be checked at and around the failing width,
not merely at a single screenshot:

- widths 620–680 CSS pixels, including 646 and 650;
- picker at rest and every selection position;
- first, middle, and last item;
- selection adjacent to section breaks and info panels;
- animated and static ambient substrates;
- each supported font, seeded in localStorage before page load;
- DPR/zoom sweep;
- no horizontal teeth, black bar, seam, or font-dependent split;
- no regression to picker row count, scrolling, or hit regions.

## Performance budget

Block-heavy demos are intentionally a worst case, so this change must be
measured rather than presumed free.

Record before/after results for:

- `/plasma` at the default viewport and a large viewport;
- Canvas2D main-thread and worker variants;
- WebGL2 and WebGPU when their phases land;
- frame time, FPS, and allocation rate if available.

Acceptance guidance:

- the decoder allocates nothing per cell or frame;
- Canvas2D block-heavy median frame time should not regress by more than 10%
  without an explicit follow-up decision;
- GPU procedural rendering should remain within 5% of its prior block-heavy
  throughput;
- ordinary text/dashboard performance should remain statistically unchanged.

Correctness takes precedence over these provisional thresholds, but a breach
must be documented and explained rather than silently accepted.

## Landing sequence

### Commit 1: record and pure semantics

- add this decision record;
- add `block-elements.ts` and exhaustive pure tests;
- no painter behavior changes.

### Commit 2: Canvas2D opaque geometry

- route Block Elements around `fillText` in `paint()`;
- add control-flow and opaque pixel tests;
- verify the demo fixture.

### Commit 3: Canvas2D layered compositing

- give `paintOver()` independent fg/bg coverage;
- add transparent-substrate and shade tests;
- verify compatibility with Hack 10.

### Commit 4: Washe consumption

- advance the vendored fork;
- remove forced alpha and font-metric comments;
- update tests and width/font/DPR evidence.

### Commit 5: WebGL2

- procedural path and parity/performance evidence;
- update support matrix.

### Commit 6: WebGPU

- WGSL path and parity/performance evidence;
- retire the README's direct-painter Block Element limitation.

The branch may contain fewer commits if review favors squashing, but the phases
should remain independently reviewable in the PR narrative. Canvas2D may ship
before GPU support if the README and tests state the temporary matrix honestly.

## Alternatives considered

### Keep the Washe picker workaround

Rejected. It encodes observed font ink into application logic, fixes one call
site, and leaves OpenTUI supersampling and every other Block Element user exposed
to the same renderer defect.

### Add `paintHalfRect` to OpenTUI or `CellGrid`

Rejected for this issue. A richer high-level primitive is possible in principle,
as `drawSuperSampleBuffer` demonstrates, but the current cell already contains
the exact lowered result. Adding parallel geometry would duplicate state, grow
worker messages, complicate ANSI fallback, and still require painters to support
existing block codepoints.

### Patch only U+2580

Rejected. The same font mechanism affects the complete contiguous range, and
OpenTUI's supersampler emits half and quadrant characters beyond U+2580. A
single-character branch would be a call-site workaround moved one layer down.

### Use a bundled “correct” terminal font

Rejected. It would make cell geometry depend on font loading, browser
rasterization, fallback, hinting, and platform metrics. It would also prevent
font choice from remaining an application concern.

### Stretch or scale the glyph to the cell

Rejected. Scaling can remove some bearings but distorts shades, creates
filtering artifacts, and still relies on glyph ink/baseline bounds. Procedural
coverage is simpler and exact.

### Reuse the existing text atlas with `NEAREST`

Rejected as the main design. It may reduce filtering seams but does not remove
font-dependent glyph coverage or atlas padding problems, and globally changing
filtering can degrade ordinary text.

### Canvas2D-only private special case

Rejected as the architecture, though Canvas2D is the first delivery phase. The
fork exists to compare multiple backends. The semantic decoder and tests must be
shared even when backend implementations land at different times.

### Change ghostty-web first

Rejected as a dependency. ghostty-web deserves an upstream fix, but Washe's
current production path deliberately uses the direct `CanvasPainter`. The fork
owns correctness for that painter and can land independently.

### Procedurally render Box Drawing at the same time

Deferred. U+2500–U+257F has the same family resemblance and native Ghostty also
uses sprites for it, but line weights, joins, arcs, and mixed single/double
connections are a larger semantic set. Hack 11 should establish reusable
machinery without expanding the acceptance surface beyond Block Elements.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Background pass still paints under a layered block | Black bar/full-cell band remains | Explicit `paintOver` skip plus transparent checkerboard pixel test |
| Independent rounding creates a one-pixel crack | Original seam survives at some DPR | Absolute shared device edges and odd-size/DPR matrix |
| Last-row stretch or `FLUSH_BOTTOM` is bypassed | wc-bar/full-bleed regressions | Feed existing effective origin/height into mask lowering; dedicated tests |
| Shade alpha is composed incorrectly | Washed-out or opaque `░▒▓` | Premultiplied coverage equation and fg/bg alpha truth table |
| GPU shader table diverges from TypeScript | Backend-specific wrong quadrants | Generate mapping or exhaustively validate against canonical descriptors |
| Font path still handles some range members | Future glyph-dependent artifacts | Test every codepoint and assert zero `fillText` calls |
| New per-cell allocations hurt plasma | Frame-rate regression | Static descriptors, allocation test/profile, recorded benchmark |
| Washe cleanup lands before fork support | Temporary black bar regression | Fork first, consuming change second |
| ghostty-web still differs | Renderer matrix remains inconsistent | Treat as explicit upstream issue, not a hidden local fallback |
| Documentation overstates standards | Incorrect portability claim | Distinguish Unicode semantics, project contract, and alpha extension explicitly |

## Acceptance criteria

Hack 11 is complete when all of the following are true:

- [ ] The complete U+2580–U+259F decoder is checked in and exhaustively tested.
- [ ] Canvas2D never sends a recognized Block Element to `fillText`.
- [ ] Canvas2D opaque rendering has exact font-independent block edges.
- [ ] Canvas2D `paintOver` independently composes foreground and background
      coverage, including transparent halves and shades.
- [ ] Odd dimensions and fractional DPR have no missing or double-composited edge
      pixels.
- [ ] Existing glyph decorations, stretched rows, final columns, and
      `FLUSH_BOTTOM` behavior remain covered.
- [ ] Main-thread and worker Canvas2D paths match.
- [ ] Washe no longer forces a sampled transparent foreground to alpha one.
- [ ] Washe's picker passes the width/font/DPR sweep without teeth, black bars,
      seams, or asymmetric font ink.
- [ ] The README accurately states Canvas2D/GL/GPU support at every landing stage.
- [ ] WebGL2 uses procedural Block Element coverage and passes parity tests.
- [ ] WebGPU uses procedural Block Element coverage and passes parity tests.
- [ ] Performance results are attached to the implementation review.
- [ ] Any remaining ghostty-web difference is recorded upstream or explicitly
      listed as external.

If the branch intentionally stops after the Canvas2D phase, call that milestone
“Hack 11 Canvas2D complete,” leave the overall record `Partially implemented`,
and keep the GL/GPU checklist open. Do not mark the full hack complete while a
direct painter still claims the range through its font atlas.

## Rollback

The implementation should be reversible without changing application buffers:

1. revert the painter routing commits to restore font glyph rendering;
2. retain the pure decoder and this record if they remain useful for a revised
   implementation;
3. roll Washe back to the prior fork branch before restoring its forced-alpha
   workaround;
4. never migrate persisted state or the `CellGrid` schema as part of this hack,
   so rollback requires no data conversion.

Because Hack 11 follows a stacked fork branch, its commits must avoid rewriting
Hacks 01–10. Changes around the same CanvasPainter loops should be minimal and
reviewed against every earlier local comment/invariant.

## Questions to resolve during implementation

These questions do not reopen the decision to use procedural coverage, but their
answers must be recorded in the completed document:

1. Does CSS-space `fillRect` pass every fractional-DPR pixel test, or must
   Canvas2D draw Block Elements in explicit device coordinates?
2. Is generated shader logic or a small nearest-filtered mask texture simpler
   and faster for GL/GPU while preserving one canonical semantic table?
3. Where should browser golden tests live, given that `opentui-browser` currently
   has no package-local test script and `web-demo` already has Vitest?
4. What measured performance thresholds are stable enough to turn the provisional
   budget into CI gates?
5. Does ghostty-web reproduce the gap with its default font in the comparison
   fixture, and if so, should the upstream report cover only Block Elements or
   the broader terminal sprite ranges?

## Source index

### Standards and layout

- Unicode names and coverage: [Block Elements names list](https://www.unicode.org/charts/nameslist/n_2580.html)
- Unicode chart: [U+2580–U+259F](https://www.unicode.org/charts/PDF/U2580.pdf)
- Canvas text operation: [WHATWG `fillText`](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-filltext-dev)
- Canvas rectangle operation: [WHATWG `fillRect`](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-fillrect)
- Yoga rounding: [`PixelGrid.cpp`](https://github.com/react/yoga/blob/main/yoga/algorithm/PixelGrid.cpp)

### OpenTUI and this fork

- Whole-cell Yoga configuration: [`Renderable.ts`](../packages/opentui/packages/core/src/Renderable.ts#L199-L202)
- Whole-cell buffer rectangle: [`buffer.ts`](../packages/opentui/packages/core/src/buffer.ts#L290-L292)
- High-level supersampling wrapper: [`buffer.ts`](../packages/opentui/packages/core/src/buffer.ts#L347-L365)
- Supersampling lowering: [`buffer.zig`](../packages/opentui/packages/core/src/zig/buffer.zig#L1877-L1921)
- Quadrant codepoint table: [`buffer.zig`](../packages/opentui/packages/core/src/zig/buffer.zig#L2159-L2176)
- Browser cell contract: [`cell-grid.ts`](../packages/opentui-browser/src/cell-grid.ts#L10-L17)
- Canvas2D background/text passes: [`canvas-painter.ts`](../packages/opentui-browser/src/canvas-painter.ts#L235-L338)
- WebGL atlas path: [`canvas-gl-painter.ts`](../packages/opentui-browser/src/canvas-gl-painter.ts#L84-L95)
- WebGPU atlas path: [`canvas-gpu-painter.ts`](../packages/opentui-browser/src/canvas-gpu-painter.ts#L82-L91)
- Existing GPU limitation: [`README.md`](../README.md#visual-artefacts-on-the-webgl--webgpu-variants)

### Ghostty family

- Native Ghostty Block Element dispatch: [`block.zig`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/font/sprite/draw/block.zig#L30-L108)
- Native Ghostty geometric lowering: [`block.zig`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/font/sprite/draw/block.zig#L121-L176)
- Native Ghostty shade masks: [`common.zig`](https://github.com/ghostty-org/ghostty/blob/5714ed07a1012573261b7b7e3ed2add9c1504496/src/font/sprite/draw/common.zig#L42-L51)
- ghostty-web Canvas text renderer: [`renderer.ts`](https://github.com/coder/ghostty-web/blob/1858a5947767a3e1c9e98dbf53b2ff87fedb2aab/lib/renderer.ts#L637-L650)

Pinned Ghostty and ghostty-web links record the implementations inspected while
making this decision. Relative links into this repository intentionally follow
the branch so the record stays adjacent to the code it governs.

## Exemplar structure for Hacks 01–10

Back-filled hack records should use the same narrative skeleton. Not every hack
needs this many words, but every record should make the modification
reconstructible without reading an old chat transcript.

### Mandatory sections

1. **Metadata table** — status, branch, dependency, origin, scope, date, and one
   sentence stating the decision.
2. **Executive decision** — what changes, what does not, and which layer owns it.
3. **Observed problem** — concrete symptom and the environment that exposed it.
4. **Evidence chain** — code/standard/runtime facts in the order that supports
   the decision; pin external source revisions when behavior may change.
5. **Decision and invariants** — properties future edits must preserve.
6. **Implementation/file plan** — named files and responsibilities, not only a
   prose intention.
7. **Verification** — unit, integration, real-runtime, and regression evidence;
   explicitly name what each layer cannot catch.
8. **Alternatives considered** — include rejected local workarounds and why.
9. **Risks and mitigations** — especially interactions with earlier stacked
   hacks.
10. **Acceptance criteria** — checkable completion conditions.
11. **Rollback** — how to remove the hack without damaging earlier branches.
12. **Source index** — local code citations and primary external references.

### Optional sections

- semantic or data model;
- alpha/compositing equations;
- device-pixel rounding rules;
- performance budget;
- staged backend rollout;
- consuming-repository cleanup;
- unresolved implementation questions.

### Backfill rule

Document the reason visible at the time each hack was introduced, then validate
it against current code. Do not retrofit a cleaner motivation that was not true,
and do not preserve a stale explanation merely because it appears in a commit
message. When later hacks supersede part of an earlier decision, both records
should say so and link to each other.

For this stacked series specifically, every back-filled record should identify:

- the immediately preceding `washe/hack/NN` dependency;
- the Washe issue or visual regression that required the fork change;
- which CanvasPainter invariant was added;
- the consuming Washe capability check or vendoring step;
- the test gap that allowed the original defect;
- whether a later hack modifies the same paint pass, attribute bit, viewport
  calculation, or alpha rule.

That turns `hacks/` into an architectural history of the fork rather than a
second changelog.
