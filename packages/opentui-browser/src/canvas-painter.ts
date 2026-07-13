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
import type { CellGrid } from './cell-grid'

const ATTR_BOLD = 1 << 0
const ATTR_ITALIC = 1 << 2
const ATTR_UNDERLINE = 1 << 3
// washe local fix (#148): GFM strikethrough. Matches opentui core's
// TextAttributes.STRIKETHROUGH (1<<7); the cell buffer stores attributes as a
// u8 and this painter masks attrs & 0xff, so bit 7 round-trips. Drawn below as
// a rule through the glyph's vertical middle (UNDERLINE alone can't strike).
const ATTR_STRIKETHROUGH = 1 << 7

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
    const { width, height, chars, fg, bg, attrs } = 'snapshot' in input ? input.snapshot() : input
    if (width !== this.cols || height !== this.rows) {
      // Caller is supposed to keep these in sync, but be defensive.
      this.resize(width, height)
    }
    const cellW = this.cellWidth
    const cellH = this.cellHeight
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

    let lastBg = ''
    let lastFg = ''
    let lastFontStyle = ''
    const baseFont = `${this.fontSize}px ${this.fontFamily}`

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
        const br = (bg[fi]! * 255) | 0
        const bgg = (bg[fi + 1]! * 255) | 0
        const bb = (bg[fi + 2]! * 255) | 0
        const bgKey = `rgb(${br},${bgg},${bb})`
        if (bgKey !== lastBg) {
          ctx.fillStyle = bgKey
          lastBg = bgKey
        }
        const colW = x === width - 1 ? Math.max(cellW, this.cssWidth - x * cellW) : cellW
        ctx.fillRect(x * cellW, py, colW, rowH)
      }
    }

    for (let y = 0; y < height; y++) {
      const py = y * cellH
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const ch = chars[i]!
        const ai = attrs[i]! & 0xff
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
        if (fgKey !== lastFg) {
          ctx.fillStyle = fgKey
          lastFg = fgKey
        }
        // washe local fix (#104): per-cell vertical alignment. VALIGN rides
        // attr bits 4-5 (0=top, 1=middle, 2=bottom); 0 falls back to the
        // painter-wide default. The offset is DERIVED FROM METRICS — never a
        // hardcoded pixel — so it self-scales with fontSize/dpr. va=0 ⇒
        // voff=0, byte-identical to upstream for non-opted cells.
        const vaBits = (ai >> 4) & 3
        const va = vaBits !== 0 ? vaBits : this.cellVAlignDefault
        const voff =
          va === 1 ? Math.round((cellH - this.fontSize) / 2) : va === 2 ? cellH - this.fontSize : 0
        if (ch !== 0x20) {
          const wantFont = fontFor(ai, baseFont, this.fontSize, this.fontFamily)
          if (wantFont !== lastFontStyle) {
            ctx.font = wantFont
            lastFontStyle = wantFont
          }
          ctx.fillText(stringForCp(ch), x * cellW, py + voff)
        }
        if (ai & ATTR_UNDERLINE) {
          // washe local fix (#6): pin the underline just under the glyph
          // baseline, not the cell bottom. textBaseline is 'top', so text
          // spans py..py+fontSize while the cell is taller (cellH ≈
          // 1.2×fontSize) — drawing at the cell bottom floated the rule
          // well below the words. py+fontSize-4 tucks it right under the
          // text (clamped into the cell). It tracks voff so a vertically
          // shifted glyph keeps its underline (clamped to the cell bottom).
          const uy = Math.min(py + cellH - 1, py + voff + Math.min(cellH - 1, this.fontSize - 4))
          ctx.fillRect(x * cellW, uy, cellW, 1)
        }
        if (ai & ATTR_STRIKETHROUGH) {
          // washe local fix (#148): a rule through the glyph's vertical MIDDLE
          // (≈ the x-height center), tracking voff like the underline so a
          // valign-shifted glyph keeps its strike. textBaseline is 'top', so
          // the glyph spans py+voff..py+voff+fontSize; half the font height
          // lands the rule across the letterforms. Clamped into the cell.
          const sy = Math.min(
            py + cellH - 1,
            py + voff + Math.round(this.fontSize / 2),
          )
          ctx.fillRect(x * cellW, sy, cellW, 1)
        }
      }
    }
  }
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
