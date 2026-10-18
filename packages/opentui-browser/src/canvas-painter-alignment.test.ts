import { describe, expect, it } from 'vitest'
import { CanvasPainter, type CanvasPainterOptions } from './canvas-painter'
import type { CellGrid } from './cell-grid'

type Ink = { ascent: number; descent: number }

class MetricContext {
  font = ''
  textBaseline: CanvasTextBaseline = 'alphabetic'
  fillStyle = '#000'
  readonly texts: { text: string; y: number; baseline: CanvasTextBaseline; font: string }[] = []
  readonly fills: { y: number; height: number; style: string }[] = []

  constructor(
    readonly topToBaseline: number,
    readonly reference: Ink | null = { ascent: 17, descent: 4 },
    readonly topReference?: Ink,
  ) {}

  measureText(text: string): TextMetrics {
    if (this.reference === null) return { width: 14 } as TextMetrics
    if (text === 'Mg' && this.textBaseline === 'top' && this.topReference) {
      return {
        width: 14,
        actualBoundingBoxAscent: this.topReference.ascent,
        actualBoundingBoxDescent: this.topReference.descent,
      } as TextMetrics
    }
    const ink = text === 'Mg' ? this.reference : { ascent: text === 'x' ? 12 : 17, descent: 0 }
    const offset = this.textBaseline === 'top' ? this.topToBaseline : 0
    return {
      width: 14,
      actualBoundingBoxAscent: ink.ascent - offset,
      actualBoundingBoxDescent: ink.descent + offset,
    } as TextMetrics
  }

  save() {}
  restore() {}
  setTransform() {}
  fillText(text: string, _x: number, y: number) {
    this.texts.push({ text, y, baseline: this.textBaseline, font: this.font })
  }
  fillRect(_x: number, y: number, _width: number, height: number) {
    this.fills.push({ y, height, style: this.fillStyle })
  }
}

function paint(
  ctx: MetricContext,
  text: string,
  attrs: number[],
  options: CanvasPainterOptions = { cellVAlign: 'middle' },
  { rows = 2, cssHeight = rows * 28, dpr = 1 }: { rows?: number; cssHeight?: number; dpr?: number } = {},
) {
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
  const painter = new CanvasPainter(canvas, { fontSize: 23, ...options })
  const width = text.length
  painter.resize(width, rows)
  painter.setViewport(width * 14 * dpr, cssHeight * dpr, width * 14, cssHeight)
  const n = width * rows
  const grid: CellGrid = {
    width,
    height: rows,
    chars: Uint32Array.from({ length: n }, (_, i) => text.codePointAt(i) ?? 0),
    fg: new Float32Array(n * 4).fill(1),
    bg: new Float32Array(n * 4),
    attrs: Uint32Array.from({ length: n }, (_, i) => attrs[i] ?? 0),
  }
  painter.paintOver(grid)
  return painter
}

describe('CanvasPainter measured vertical alignment', () => {
  it.each([1, 1.5, 2])('keeps the same ink position across different top anchors at DPR %s', dpr => {
    for (const topToBaseline of [18, 23]) {
      const ctx = new MetricContext(topToBaseline)
      const painter = paint(ctx, 'Mgx', [0, 1, 4], undefined, { dpr })
      // A single baseline for capitals, descenders, bold and italic. A per-glyph
      // measurement would instead bounce x and g vertically inside the row.
      expect(ctx.texts.map(t => t.y + topToBaseline)).toEqual([21, 21, 21])
      expect(ctx.texts.every(t => t.baseline === 'top')).toBe(true)
      expect(ctx.texts[1]!.font).toContain('bold')
      expect(ctx.texts[2]!.font).toContain('italic')
      const baseline = ctx.texts[0]!.y + topToBaseline
      expect(baseline - 17).toBe(4) // cap top
      expect(painter.cellHeight - (baseline + 4)).toBe(3) // descender bottom
      expect([painter.cellWidth, painter.cellHeight]).toEqual([14, 28])
    }
  })

  it('keeps the Chromium anchor and balances the WebKit ink using their measured fractional metrics', () => {
    const chromium = new MetricContext(17.78125, undefined, { ascent: -1.45125, descent: 21.50725 })
    const webkit = new MetricContext(23, undefined, { ascent: -6, descent: 27 })
    for (const ctx of [chromium, webkit]) {
      paint(ctx, 'M', [0])
      const top = ctx.texts[0]!.y - ctx.topReference!.ascent
      const bottom = 28 - (ctx.texts[0]!.y + ctx.topReference!.descent)
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1)
    }
    expect(chromium.texts[0]!.y).toBe(3) // unchanged Chromium raster anchor
    expect(webkit.texts[0]!.y).toBe(-2)
  })

  it('keeps default-top cells unchanged while honoring explicit middle and bottom cells', () => {
    const ctx = new MetricContext(23)
    paint(ctx, 'MMM', [0x10, 0, 0x20], {})
    expect(ctx.texts.map(t => [t.y, t.baseline])).toEqual([
      [-2, 'top'], [0, 'top'], [1, 'top'],
    ])
  })

  it('centers in the stretched last row and the natural bottom-flush row separately', () => {
    const ctx = new MetricContext(23)
    paint(ctx, 'MM', [0x08, 0x48], undefined, { rows: 1, cssHeight: 40 })
    expect(ctx.texts.map(t => t.y + ctx.topToBaseline)).toEqual([27, 33])
    expect(ctx.fills.map(f => f.y)).toEqual([28, 34])
    // The flushed cell occupies y=12..40: the same 4/3 ink insets as a normal cell.
    expect(ctx.texts[1]!.y + ctx.topToBaseline - 17 - 12).toBe(4)
    expect(40 - (ctx.texts[1]!.y + ctx.topToBaseline + 4)).toBe(3)
  })

  it('anchors underline and strike to the same baseline, including decorated spaces', () => {
    for (const topToBaseline of [18, 23, 35]) {
      const ctx = new MetricContext(topToBaseline)
      paint(ctx, 'M ', [0x88, 0x88])
      expect(ctx.texts).toHaveLength(1)
      expect(ctx.fills.map(f => [f.y, f.height])).toEqual([[22, 1], [15, 1], [22, 1], [15, 1]])
    }
  })

  it('leaves procedural blocks on the cell geometry instead of shifting them to a text baseline', () => {
    const ctx = new MetricContext(23)
    paint(ctx, '\u2580', [0])
    expect(ctx.texts).toEqual([])
    expect(ctx.fills.map(f => [f.y, f.height])).toEqual([[0, 14]])
  })

  it.each([
    null,
    { ascent: Number.NaN, descent: 4 },
    { ascent: 17, descent: Number.POSITIVE_INFINITY },
    { ascent: 0, descent: 0 },
    { ascent: 17, descent: -17 },
  ])('falls back to the original em-box offsets when reference metrics are unavailable or invalid: %j', reference => {
    const ctx = new MetricContext(23, reference)
    paint(ctx, 'MM', [0, 0x20])
    expect(ctx.texts.map(t => [t.y, t.baseline])).toEqual([[3, 'top'], [5, 'top']])
  })
})
