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

export interface CanvasPainterOptions {
  fontSize?: number
  fontFamily?: string
}

export class CanvasPainter {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private fontSize: number
  private fontFamily: string
  private dpr: number

  cellWidth = 0
  cellHeight = 0
  cols = 0
  rows = 0

  constructor(canvas: HTMLCanvasElement, opts: CanvasPainterOptions = {}) {
    this.canvas = canvas
    this.fontSize = opts.fontSize ?? 13
    this.fontFamily = opts.fontFamily ?? 'ui-monospace, SFMono-Regular, Menlo, monospace'
    this.dpr = window.devicePixelRatio || 1
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

  // Resize the canvas backing store + CSS size to match cols × rows. Idempotent.
  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return
    this.cols = cols
    this.rows = rows
    const cssW = cols * this.cellWidth
    const cssH = rows * this.cellHeight
    this.canvas.width = Math.ceil(cssW * this.dpr)
    this.canvas.height = Math.ceil(cssH * this.dpr)
    this.canvas.style.width = `${cssW}px`
    this.canvas.style.height = `${cssH}px`
    // setTransform replaces (vs scale which accumulates) — safe to call on every resize.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
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

    let lastBg = ''
    let lastFg = ''
    let lastFontStyle = ''
    const baseFont = `${this.fontSize}px ${this.fontFamily}`

    // Two-pass-per-row: backgrounds first, then chars. Same row both passes
    // before moving on, which keeps memory access patterns linear.
    for (let y = 0; y < height; y++) {
      const py = y * cellH
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
        ctx.fillRect(x * cellW, py, cellW, cellH)
      }
    }

    for (let y = 0; y < height; y++) {
      const py = y * cellH
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const ch = chars[i]!
        if (ch === 0 || ch === 0x20) continue
        const ai = attrs[i]! & 0xff
        const fi = i * 4
        const fr = (fg[fi]! * 255) | 0
        const fgg = (fg[fi + 1]! * 255) | 0
        const fb = (fg[fi + 2]! * 255) | 0
        const fgKey = `rgb(${fr},${fgg},${fb})`
        if (fgKey !== lastFg) {
          ctx.fillStyle = fgKey
          lastFg = fgKey
        }
        const wantFont = fontFor(ai, baseFont, this.fontSize, this.fontFamily)
        if (wantFont !== lastFontStyle) {
          ctx.font = wantFont
          lastFontStyle = wantFont
        }
        ctx.fillText(stringForCp(ch), x * cellW, py)
        if (ai & ATTR_UNDERLINE) {
          ctx.fillRect(x * cellW, py + cellH - 1, cellW, 1)
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
