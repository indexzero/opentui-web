// Direct canvas painter — reads opentui's cell grid and paints it straight to
// a 2D canvas. Drops the ghostty-web ANSI parse + paint pipeline entirely.
//
// What you lose vs ghostty-web:
//   - VT100 emulation (escape sequences from external programs)
//   - Built-in selection / scrollback / paste
//   - Mouse events with OSC8 hyperlinks
//   - Complex-script multi-pass rendering (Devanagari, Arabic, etc.)
//
// What you gain:
//   - One less roundtrip per frame (no ANSI encode → parse → repaint)
//   - Direct control over the painter
//
// Best fit: pixel/effect demos where every cell is just a colored block
// (plasma, particles, etc). For terminal-emulator-shaped apps, keep
// ghostty-web.

import type { OpentuiBuffer } from './buffer'
import { decodeBlockElement, type BlockElementMask, type UnitRect } from './block-elements'
import type { CellGrid } from './cell-grid'

const ATTR_BOLD = 1 << 0
const ATTR_ITALIC = 1 << 2
const ATTR_UNDERLINE = 1 << 3
// washe local fix (#148): GFM strikethrough. Matches opentui core's
// TextAttributes.STRIKETHROUGH (1<<7); the cell buffer stores attributes as a
// u8 and this painter masks attrs & 0xff, so bit 7 round-trips. Drawn below as
// a rule through the glyph's vertical middle (UNDERLINE alone can't strike).
const ATTR_STRIKETHROUGH = 1 << 7
// washe local fix (#178): bottom-flush. A last-row cell with this bit anchors at
// its natural cellH against the bottom edge instead of stretching up to fill the
// sub-cell remainder — the wc-bar reads one cell tall AND flush. Bit 6 is free
// (bold=0, italic=2, underline=3, valign=4-5, strike=7) and survives attrs&0xff.
const ATTR_FLUSH_BOTTOM = 1 << 6

export interface CanvasPainterOptions {
  fontSize?: number
  fontFamily?: string
  // washe local fix (#104): painter-wide default vertical alignment of a
  // glyph within its (taller) cell box. 'top' (default) is byte-identical to
  // upstream; 'middle'/'bottom' derive the offset from metrics (see paint()).
  // A per-cell VALIGN in attr bits 4-5 overrides this default.
  cellVAlign?: 'top' | 'middle' | 'bottom'
  // washe local fix (canvas-host overhaul): the page background painted under
  // the whole backing store before each frame. The grid is whole cells (floor),
  // so a sub-cell remainder strip on the right/bottom would otherwise render as
  // the opaque-black default of getContext('2d',{alpha:false}). Default '#000'
  // is byte-identical to the prior implicit clear for callers that don't set it.
  clearColor?: string
}

export class CanvasPainter {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private fontSize: number
  private fontFamily: string
  // washe local fix (#104): default vertical-align as a small enum
  // (0=top, 1=middle, 2=bottom); used when a cell's VALIGN bits are 0.
  private cellVAlignDefault: number
  // washe local fix (canvas-host overhaul): page bg for the pre-frame clear.
  private clearColor: string
  // washe local fix (canvas-host overhaul): last measured CSS px of the canvas,
  // set by setViewport. Used to stretch the LAST row/column's cell background out
  // to the canvas edge so edge-touching bands (substrate, code block, wc-bar)
  // are full-bleed instead of stopping at the whole-cell grid edge (cols*cellW <
  // cssW leaves a sub-cell strip). Default 0 ⇒ legacy callers see no extension.
  private cssWidth = 0
  private cssHeight = 0

  cellWidth = 0
  cellHeight = 0
  cols = 0
  rows = 0
  // washe local fix (#6/#148, engine-independent baseline): pixel offsets — from
  // the glyph's top (textBaseline='top' anchor) — at which the underline (#6) and
  // strikethrough (#148) rules are drawn. Historically these were hardcoded
  // (fontSize-4, fontSize/2), an ascent assumption calibrated on Blink; WebKit's
  // anchor→baseline distance for the same font is larger, so the rules landed
  // above the baseline and crossed the letterforms. Now MEASURED per engine in
  // measureCell() (with a fallback to the old constants). Derived once at
  // construction, alongside cellWidth/cellHeight; if a runtime fontSize/
  // fontFamily setter is ever added it must re-run measureCell to re-derive these.
  private underlineOffset = 0
  private strikeOffset = 0

  constructor(canvas: HTMLCanvasElement, opts: CanvasPainterOptions = {}) {
    this.canvas = canvas
    this.fontSize = opts.fontSize ?? 13
    this.fontFamily = opts.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace'
    this.cellVAlignDefault = ({ top: 0, middle: 1, bottom: 2 })[opts.cellVAlign ?? 'top']
    this.clearColor = opts.clearColor ?? '#000'
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('CanvasPainter: 2d context unavailable')
    this.ctx = ctx
    this.measureCell()
  }

  // Symmetry with the GL/GPU painters — nothing to release for 2d canvas.
  dispose() {}

  private measureCell() {
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`
    this.ctx.textBaseline = 'top'
    const m = this.ctx.measureText('M')
    // Round to integer pixel grid; otherwise per-cell drift accumulates and rows misalign.
    this.cellWidth = Math.max(1, Math.round(m.width))
    this.cellHeight = Math.max(1, Math.round(this.fontSize * 1.2))
    // washe local fix (#6/#148, engine-independent baseline): measure the
    // alphabetic baseline THIS engine will actually draw instead of assuming it.
    // With textBaseline='top' the top of the glyph sits at the anchor; 'M' has no
    // descender, so its actualBoundingBoxDescent is exactly the anchor→baseline
    // distance as rendered (larger on WebKit than the old Blink-tuned fontSize-4).
    // Underline sits 1px under that baseline; strike rides the x-height center.
    const bfd = m.actualBoundingBoxDescent
    // x-height = the INK-BOX HEIGHT of 'x' (ascent+descent = total box extent,
    // baseline-independent). 'x' has no ascender/descender, so its bounding-box
    // height IS the x-height. NB: actualBoundingBoxAscent ALONE is measured from
    // the textBaseline='top' anchor and is ≤ 0 for 'x' (its ink sits BELOW the
    // top line), so the ascent+descent SUM — not the ascent — is what yields the
    // height on every engine; the strike then sits at baseline − ½ x-height.
    const xm = this.ctx.measureText('x')
    const xHeight = (xm.actualBoundingBoxAscent ?? 0) + (xm.actualBoundingBoxDescent ?? 0)
    if (bfd && bfd > 0) {
      // Ceiling cellHeight-1 = the last row a 1px rule can occupy fully inside
      // the cell (fillRect at cellHeight-1 spans [cellHeight-1, cellHeight)), so
      // a large measured baseline is never capped UP onto the glyph — the very
      // regime this fix targets (WebKit's baseline sits low). Matches the paint
      // clamp and the fallback. Floor at 0 guards a degenerate tiny fontSize.
      this.underlineOffset = Math.max(0, Math.min(this.cellHeight - 1, Math.round(bfd) + 1))
      const halfX = xHeight > 0 ? xHeight / 2 : this.fontSize / 4
      this.strikeOffset = Math.max(0, Math.round(bfd - halfX))
    } else {
      // Ancient engine with no actualBoundingBox* metrics: keep the historical
      // Blink-calibrated constants so behaviour there is byte-identical to before.
      this.underlineOffset = Math.min(this.cellHeight - 1, this.fontSize - 4)
      this.strikeOffset = Math.round(this.fontSize / 2)
    }
  }

  // Compute cols/rows that will fill the given container box.
  fit(containerWidth: number, containerHeight: number): { cols: number; rows: number } {
    const cols = Math.max(1, Math.floor(containerWidth / this.cellWidth))
    const rows = Math.max(1, Math.floor(containerHeight / this.cellHeight))
    return { cols, rows }
  }

  // washe local fix (canvas-host overhaul): resize() now tracks ONLY the cell
  // grid (cols/rows). CSS owns the canvas box (the host styles it
  // absolute;inset:0;width/height:100%) and the host drives the backing store +
  // transform via setViewport() from MEASURED device px. The defensive paint()
  // path calls this on buffer/grid drift, so it must NEVER touch canvas.style.*,
  // the backing store, or the transform — doing so would re-introduce R-1 (a
  // CSS-px ↔ device-px mismatch). Grid-only, so the cols/rows early-return is
  // dropped: the device-px sizing that DOES need to fire on dpr/CSS changes with
  // an unchanged grid lives in setViewport, behind no such guard.
  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  // washe local fix (canvas-host overhaul): size the backing store to EXACT
  // device px (measured by the host's ResizeObserver device-pixel-content-box)
  // and set the CSS→device transform so cell coords stay in CSS px while text
  // rasterizes crisp. Owns the backing store + transform ONLY — never
  // canvas.style.* (CSS owns the box). Setting canvas.width/height RESETS the 2D
  // context, so font/baseline/transform are (re)established here afterward.
  setViewport(deviceW: number, deviceH: number, cssW: number, cssH: number) {
    if (this.canvas.width !== deviceW || this.canvas.height !== deviceH) {
      this.canvas.width = deviceW
      this.canvas.height = deviceH
    }
    this.cssWidth = cssW
    this.cssHeight = cssH
    // Per-axis ratio from MEASURED dims (not devicePixelRatio, which is lossy at
    // fractional dpr / zoom). setTransform replaces — safe to call every resize.
    this.ctx.setTransform(deviceW / cssW, 0, 0, deviceH / cssH, 0, 0)
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`
    this.ctx.textBaseline = 'top'
  }

  // Paint a full frame from the buffer or from a pre-snapshotted CellGrid
  // (the worker path hands us the latter).
  paint(input: OpentuiBuffer | CellGrid) {
    const ctx = this.ctx
    // washe local fix (canvas-host overhaul): clear the FULL backing store to
    // the page bg before any cells — UNCONDITIONALLY (before any guard) so even
    // a defensive/no-op frame leaves bg, not black. With alpha:false unpainted
    // pixels are opaque black; the whole-cell grid (floor) leaves a sub-cell
    // remainder strip on the right/bottom that would otherwise read black and
    // fail the ≥80% paint-coverage invariant. Cleared in DEVICE space (identity
    // transform) so it covers every backing-store pixel regardless of the
    // CSS-space transform; also kills the first-frame flash after a resize.
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = this.clearColor
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.restore()
    this.paintCells(input, false)
  }

  // washe local fix (ambient-layer compositing): composite a CONTENT buffer over whatever is
  // already on the canvas (the substrate frame paint() just committed). Two
  // differences from paint():
  //   1. NO pre-frame clear — the substrate pixels stay put; we draw over them.
  //   2. The bg pass HONORS per-cell bg alpha: alpha 0 cells skip the fill
  //      entirely (the substrate pixel keeps showing), fractional alpha blends
  //      via rgba(), alpha ≥ 1 fills opaque as before.
  // The char pass is unchanged (it already skips char===0 and honors fg alpha).
  paintOver(input: OpentuiBuffer | CellGrid) {
    this.paintCells(input, true)
  }

  // The two per-row passes (backgrounds, then chars) shared by paint() and
  // paintOver(). honorBgAlpha=false is byte-identical to the historical paint()
  // body: bg alpha is IGNORED and every cell fills opaque rgb(...).
  private paintCells(input: OpentuiBuffer | CellGrid, honorBgAlpha: boolean) {
    const { width, height, chars, fg, bg, attrs } = 'snapshot' in input ? input.snapshot() : input
    if (width !== this.cols || height !== this.rows) {
      // Caller is supposed to keep these in sync, but be defensive.
      this.resize(width, height)
    }
    const cellW = this.cellWidth
    const cellH = this.cellHeight
    const ctx = this.ctx

    let lastBg = ''
    let lastFg = ''
    let lastFontStyle = ''
    const baseFont = `${this.fontSize}px ${this.fontFamily}`

    // washe local fix (#178): the bottom sub-cell remainder (cssHeight not an
    // exact multiple of cellH). Cells flagged FLUSH_BOTTOM on the last row
    // bottom-anchor at their natural cellH across this gap (see below).
    const rem = this.cssHeight > 0 ? Math.max(0, this.cssHeight - height * cellH) : 0

    // Two-pass-per-row: backgrounds first, then chars. Same row both passes
    // before moving on, which keeps memory access patterns linear.
    for (let y = 0; y < height; y++) {
      const py = y * cellH
      // washe local fix (canvas-host overhaul): the cell grid is whole cells, so
      // a sub-cell remainder can sit between the last row/column and the canvas
      // edge. This pass runs UNDER the CSS→device transform, so we extend in CSS
      // px (cssWidth/cssHeight, the context's coordinate space) — NOT device px —
      // to stretch the LAST row/column's bg to the edge. Edge-touching bands
      // (substrate, code block, wc-bar) become full-bleed; page-bg cells just
      // extend page bg (invisible). cssWidth/cssHeight default 0 for legacy
      // callers that never call setViewport, so Math.max keeps the plain cellW/cellH.
      const rowH = y === height - 1 ? Math.max(cellH, this.cssHeight - py) : cellH
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const fi = i * 4
        // A layered Block Element owns both disjoint colour regions. Painting
        // bg across the full cell here would hide the substrate beneath a
        // transparent foreground region before the procedural pass sees it.
        if (honorBgAlpha && decodeBlockElement(chars[i]!) !== null) continue
        // washe local fix (ambient-layer compositing): the compositing (paintOver) path honors
        // bg alpha — alpha 0 skips the fill (substrate pixel shows through),
        // fractional alpha blends over it. The opaque paint() path keeps the
        // historical behavior: alpha ignored, every cell fills rgb(...).
        const ba = honorBgAlpha ? bg[fi + 3]! : 1
        if (ba <= 0) continue
        const br = (bg[fi]! * 255) | 0
        const bgg = (bg[fi + 1]! * 255) | 0
        const bb = (bg[fi + 2]! * 255) | 0
        const bgKey = ba >= 1 ? `rgb(${br},${bgg},${bb})` : `rgba(${br},${bgg},${bb},${ba})`
        if (bgKey !== lastBg) {
          ctx.fillStyle = bgKey
          lastBg = bgKey
        }
        const colW = x === width - 1 ? Math.max(cellW, this.cssWidth - x * cellW) : cellW
        // washe local fix (#178): a FLUSH_BOTTOM cell on the last row anchors at
        // its natural cellH against the BOTTOM edge (py+rem .. cssHeight) instead
        // of stretching the whole cell up by the remainder — the wc-bar stays one
        // cell tall AND sits flush. The remainder strip above keeps the page-bg
        // clear (invisible). Non-flagged last-row cells keep the full-bleed
        // stretch (substrate, fullscreen effects, edge-to-edge code panels).
        if (y === height - 1 && (attrs[i]! & 0xff & ATTR_FLUSH_BOTTOM) !== 0) {
          ctx.fillRect(x * cellW, py + rem, colW, cellH)
        } else {
          ctx.fillRect(x * cellW, py, colW, rowH)
        }
      }
    }

    for (let y = 0; y < height; y++) {
      const py = y * cellH
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const ch = chars[i]!
        const ai = attrs[i]! & 0xff
        // washe local fix (#178): a FLUSH_BOTTOM last-row cell draws its glyph
        // shifted down by the remainder so it stays centered in the bottom-
        // anchored band (matches the bg fillRect above). Non-flagged cells use py.
        const pyc = y === height - 1 && (ai & ATTR_FLUSH_BOTTOM) !== 0 ? py + rem : py
        // washe local fix (#4): empty cells draw nothing, but an
        // underlined SPACE must still draw its rule so a multi-word link
        // underlines continuously across the spaces. Only the truly-blank
        // fast path (space with no underline) is skipped.
        // washe local fix (#148): a STRUCK space must likewise draw its rule so
        // strikethrough runs continuously across inter-word spaces.
        if (ch === 0) continue
        if (ch === 0x20 && !(ai & (ATTR_UNDERLINE | ATTR_STRIKETHROUGH))) continue
        const fi = i * 4
        const fr = (fg[fi]! * 255) | 0
        const fgg = (fg[fi + 1]! * 255) | 0
        const fb = (fg[fi + 2]! * 255) | 0
        // washe local fix: honor the per-cell fg alpha (fg[fi+3]) so the
        // renderer can fade text in word-by-word (LH10 per-word reveal).
        // The 2D context's bg is opaque, so an rgba glyph composites over
        // the already-drawn background — a true per-cell opacity fade.
        const fa = fg[fi + 3]!
        const fgKey =
          fa >= 1 ? `rgb(${fr},${fgg},${fb})` : `rgba(${fr},${fgg},${fb},${fa})`
        const block = decodeBlockElement(ch)
        // washe local fix (#104): per-cell vertical alignment. VALIGN rides
        // attr bits 4-5 (0=top, 1=middle, 2=bottom); 0 falls back to the
        // painter-wide default. The offset is DERIVED FROM METRICS — never a
        // hardcoded pixel — so it self-scales with fontSize/dpr. va=0 ⇒
        // voff=0, byte-identical to upstream for non-opted cells.
        const vaBits = (ai >> 4) & 3
        const va = vaBits !== 0 ? vaBits : this.cellVAlignDefault
        // washe local fix (#463): the LAST row STRETCHES to swallow the sub-cell
        // remainder (patch 05's full-bleed rule), so its painted box is taller
        // than cellH. A valigned glyph must centre against the box it is drawn
        // in, or it lands rem/2 high — visibly so on a bar that owns that row.
        // A FLUSH_BOTTOM cell declines the stretch and keeps its natural cellH,
        // so it is excluded and illuminate's wc-bar is byte-identical.
        const vaH =
          y === height - 1 && (ai & ATTR_FLUSH_BOTTOM) === 0
            ? Math.max(cellH, this.cssHeight - py)
            : cellH
        const voff =
          va === 1 ? Math.round((vaH - this.fontSize) / 2) : va === 2 ? vaH - this.fontSize : 0
        if (block !== null) {
          const ba = bg[fi + 3]!
          const br = (bg[fi]! * 255) | 0
          const bgg = (bg[fi + 1]! * 255) | 0
          const bb = (bg[fi + 2]! * 255) | 0
          const rowH = y === height - 1 ? Math.max(cellH, this.cssHeight - py) : cellH
          const colW = x === width - 1 ? Math.max(cellW, this.cssWidth - x * cellW) : cellW
          const flushBottom = y === height - 1 && (ai & ATTR_FLUSH_BOTTOM) !== 0
          const scaleX = this.cssWidth > 0 ? this.canvas.width / this.cssWidth : 1
          const scaleY = this.cssHeight > 0 ? this.canvas.height / this.cssHeight : 1
          paintBlockElement(
            ctx,
            block,
            x * cellW,
            flushBottom ? py + rem : py,
            colW,
            flushBottom ? cellH : rowH,
            fr,
            fgg,
            fb,
            fa,
            br,
            bgg,
            bb,
            ba,
            honorBgAlpha,
            scaleX,
            scaleY,
          )
          // The procedural helper owns fillStyle. Invalidate the text cache so
          // the next ordinary glyph cannot inherit its last geometric colour.
          lastFg = ''
        } else if (ch !== 0x20) {
          if (fgKey !== lastFg) {
            ctx.fillStyle = fgKey
            lastFg = fgKey
          }
          const wantFont = fontFor(ai, baseFont, this.fontSize, this.fontFamily)
          if (wantFont !== lastFontStyle) {
            ctx.font = wantFont
            lastFontStyle = wantFont
          }
          ctx.fillText(stringForCp(ch), x * cellW, pyc + voff)
        }
        if (ai & ATTR_UNDERLINE) {
          if (fgKey !== lastFg) {
            ctx.fillStyle = fgKey
            lastFg = fgKey
          }
          // washe local fix (#6, engine-independent baseline): pin the underline
          // just under the MEASURED glyph baseline (underlineOffset, from
          // measureCell), not the cell bottom and not a Blink-tuned fontSize-4
          // guess. textBaseline is 'top', so the glyph top is at pyc+voff; the
          // measured offset drops the rule right under the letterforms on every
          // engine (WebKit's baseline sits lower than Blink's for this font, so
          // the old constant crossed the glyphs like a strike). Tracks voff so a
          // valign-shifted glyph keeps its underline; clamped to the cell bottom.
          const uy = Math.min(pyc + cellH - 1, pyc + voff + this.underlineOffset)
          ctx.fillRect(x * cellW, uy, cellW, 1)
        }
        if (ai & ATTR_STRIKETHROUGH) {
          if (fgKey !== lastFg) {
            ctx.fillStyle = fgKey
            lastFg = fgKey
          }
          // washe local fix (#148, engine-independent baseline): a rule through
          // the x-height CENTER (strikeOffset = measured baseline − ½ x-height,
          // from measureCell), tracking voff like the underline so a
          // valign-shifted glyph keeps its strike. Replaces the fontSize/2 guess,
          // which — with WebKit's lower baseline — drifted off the letter middle.
          // Clamped into the cell.
          const sy = Math.min(pyc + cellH - 1, pyc + voff + this.strikeOffset)
          ctx.fillRect(x * cellW, sy, cellW, 1)
        }
      }
    }
  }
}

function paintBlockElement(
  ctx: CanvasRenderingContext2D,
  mask: BlockElementMask,
  x: number,
  y: number,
  width: number,
  height: number,
  fr: number,
  fg: number,
  fb: number,
  fa: number,
  br: number,
  bg: number,
  bb: number,
  ba: number,
  layered: boolean,
  scaleX: number,
  scaleY: number,
): void {
  if (mask.kind === 'uniform') {
    if (!layered) {
      fillBlockRects(
        ctx,
        x,
        y,
        width,
        height,
        FULL_CELL,
        fr,
        fg,
        fb,
        clampAlpha(fa) * mask.coverage,
        scaleX,
        scaleY,
      )
      return
    }

    const foregroundAlpha = clampAlpha(fa)
    const backgroundAlpha = clampAlpha(ba)
    const backgroundCoverage = 1 - mask.coverage
    const alpha = mask.coverage * foregroundAlpha + backgroundCoverage * backgroundAlpha
    if (alpha <= 0) return
    fillBlockRects(
      ctx,
      x,
      y,
      width,
      height,
      FULL_CELL,
      Math.round(
        (mask.coverage * foregroundAlpha * fr + backgroundCoverage * backgroundAlpha * br) /
          alpha,
      ),
      Math.round(
        (mask.coverage * foregroundAlpha * fg + backgroundCoverage * backgroundAlpha * bg) /
          alpha,
      ),
      Math.round(
        (mask.coverage * foregroundAlpha * fb + backgroundCoverage * backgroundAlpha * bb) /
          alpha,
      ),
      alpha,
      scaleX,
      scaleY,
    )
    return
  }

  if (layered) {
    fillBlockRects(
      ctx,
      x,
      y,
      width,
      height,
      mask.background,
      br,
      bg,
      bb,
      ba,
      scaleX,
      scaleY,
    )
  }
  fillBlockRects(
    ctx,
    x,
    y,
    width,
    height,
    mask.foreground,
    fr,
    fg,
    fb,
    fa,
    scaleX,
    scaleY,
  )
}

const FULL_CELL: readonly UnitRect[] = Object.freeze([
  Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 }),
])

function fillBlockRects(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rectangles: readonly UnitRect[],
  r: number,
  g: number,
  b: number,
  sourceAlpha: number,
  scaleX: number,
  scaleY: number,
): void {
  const alpha = clampAlpha(sourceAlpha)
  if (alpha <= 0 || rectangles.length === 0) return
  ctx.fillStyle =
    alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
  for (const rectangle of rectangles) {
    // Compute every edge from the absolute cell origin and round in device
    // space. Shared fractional boundaries therefore resolve to the same device
    // edge even at fractional DPR or an odd cell dimension.
    const left = Math.round((x + rectangle.x0 * width) * scaleX) / scaleX
    const right = Math.round((x + rectangle.x1 * width) * scaleX) / scaleX
    const top = Math.round((y + rectangle.y0 * height) * scaleY) / scaleY
    const bottom = Math.round((y + rectangle.y1 * height) * scaleY) / scaleY
    if (right > left && bottom > top) ctx.fillRect(left, top, right - left, bottom - top)
  }
}

function clampAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha))
}

function fontFor(attrs: number, base: string, size: number, family: string): string {
  if (!(attrs & (ATTR_BOLD | ATTR_ITALIC))) return base
  const bold = attrs & ATTR_BOLD ? 'bold ' : ''
  const italic = attrs & ATTR_ITALIC ? 'italic ' : ''
  return `${italic}${bold}${size}px ${family}`
}

function stringForCp(cp: number): string {
  if (cp > 0x10ffff) return ' '
  // ASCII fast-path (common for text-heavy demos)
  if (cp < 0x80) return String.fromCharCode(cp)
  return String.fromCodePoint(cp)
}
