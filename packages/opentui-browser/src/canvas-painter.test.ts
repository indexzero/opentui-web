import { describe, expect, it } from 'vitest'

import { CanvasPainter } from './canvas-painter'
import type { CellGrid } from './cell-grid'

interface FillOperation {
  readonly style: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

class RecordingContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  font = ''
  textBaseline: CanvasTextBaseline = 'alphabetic'
  readonly fills: FillOperation[] = []
  readonly texts: { readonly text: string; readonly x: number; readonly y: number }[] = []

  measureText(text: string): TextMetrics {
    return {
      width: text === 'M' ? 10 : 7,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 8,
    } as TextMetrics
  }

  save(): void {}
  restore(): void {}
  setTransform(): void {}

  fillRect(x: number, y: number, width: number, height: number): void {
    this.fills.push({ style: String(this.fillStyle), x, y, width, height })
  }

  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y })
  }
}

function harness(width = 1, height = 1, dpr = 1) {
  const context = new RecordingContext()
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement
  const painter = new CanvasPainter(canvas, { fontSize: 10 })
  painter.resize(width, height)
  const cssWidth = width * painter.cellWidth
  const cssHeight = height * painter.cellHeight
  painter.setViewport(Math.round(cssWidth * dpr), Math.round(cssHeight * dpr), cssWidth, cssHeight)
  return { context, painter }
}

function grid(
  codepoints: readonly number[],
  foreground: readonly [number, number, number, number] = [1, 0, 0, 1],
  background: readonly [number, number, number, number] = [0, 0, 1, 1],
): CellGrid {
  const fg = new Float32Array(codepoints.length * 4)
  const bg = new Float32Array(codepoints.length * 4)
  for (let index = 0; index < codepoints.length; index++) {
    fg.set(foreground, index * 4)
    bg.set(background, index * 4)
  }
  return {
    width: codepoints.length,
    height: 1,
    chars: new Uint32Array(codepoints),
    fg,
    bg,
    attrs: new Uint32Array(codepoints.length),
  }
}

describe('CanvasPainter Block Elements', () => {
  it('routes every U+2580–U+259F codepoint around fillText', () => {
    const codepoints = Array.from({ length: 32 }, (_, index) => 0x2580 + index)
    const { context, painter } = harness(codepoints.length)
    painter.paintOver(grid(codepoints))
    expect(context.texts).toEqual([])
    expect(context.fills.length).toBeGreaterThan(0)
  })

  it('paints an upper-half foreground and lower-half background as disjoint regions', () => {
    const { context, painter } = harness()
    painter.paintOver(grid([0x2580]))
    expect(context.fills).toEqual([
      { style: 'rgb(0,0,255)', x: 0, y: 6, width: 10, height: 6 },
      { style: 'rgb(255,0,0)', x: 0, y: 0, width: 10, height: 6 },
    ])
  })

  it('leaves a transparent foreground half untouched instead of painting background beneath it', () => {
    const { context, painter } = harness()
    painter.paintOver(grid([0x2580], [0, 0, 0, 0], [0, 1, 0, 1]))
    expect(context.fills).toEqual([
      { style: 'rgb(0,255,0)', x: 0, y: 6, width: 10, height: 6 },
    ])
  })

  it('leaves a transparent background half untouched', () => {
    const { context, painter } = harness()
    painter.paintOver(grid([0x2580], [1, 0, 0, 1], [0, 0, 0, 0]))
    expect(context.fills).toEqual([
      { style: 'rgb(255,0,0)', x: 0, y: 0, width: 10, height: 6 },
    ])
  })

  it('composes shade coverage from both alpha-bearing cell colours', () => {
    const { context, painter } = harness()
    painter.paintOver(grid([0x2591], [1, 0, 0, 1], [0, 0, 1, 0]))
    expect(context.fills).toEqual([
      { style: 'rgba(255,0,0,0.25)', x: 0, y: 0, width: 10, height: 12 },
    ])
  })

  it('uses shared rounded device edges across adjacent cells at fractional scale', () => {
    const { context, painter } = harness(2, 1, 2.05)
    painter.paintOver(grid([0x2580, 0x2580], [1, 0, 0, 1], [0, 0, 0, 0]))
    expect(context.fills).toHaveLength(2)
    const [left, right] = context.fills
    expect(left!.x + left!.width).toBe(right!.x)
    expect(right!.x + right!.width).toBe(20)
  })

  it('retains ordinary font rendering outside the range', () => {
    const { context, painter } = harness()
    painter.paintOver(grid(['A'.codePointAt(0)!]))
    expect(context.texts).toEqual([{ text: 'A', x: 0, y: 0 }])
  })
})

describe('CanvasPainter background runs', () => {
  it('reduces a uniform 48 by 49 grid to one background fill per row', () => {
    const { context, painter } = harness(48, 49, 3)
    const cells = { ...grid(Array(48 * 49).fill(0x20)), width: 48, height: 49 }
    painter.paint(cells)
    expect(context.fills).toHaveLength(50) // full canvas clear + 49 rows
    expect(context.fills.slice(1)).toEqual(Array.from({ length: 49 }, (_, y) => ({
      style: 'rgb(0,0,255)', x: 0, y: y * 12, width: 480, height: 12,
    })))
  })

  it('groups effective CSS colors while ignoring alpha only in opaque paint', () => {
    const { context, painter } = harness(3)
    const cells = grid([0x20, 0x20, 0x20])
    cells.bg.set([0.5, 0, 0, 0], 0)
    cells.bg.set([0.5001, 0, 0, 0.5], 4)
    cells.bg.set([0, 1, 0, 1], 8)
    painter.paint(cells)
    expect(context.fills.slice(1)).toEqual([
      { style: 'rgb(127,0,0)', x: 0, y: 0, width: 20, height: 12 },
      { style: 'rgb(0,255,0)', x: 20, y: 0, width: 10, height: 12 },
    ])
  })

  it('does not join backgrounds across transparent cells or block elements', () => {
    const { context, painter } = harness(5)
    const cells = grid([0x20, 0x20, 0x20, 0x2580, 0x20])
    cells.bg[7] = 0
    painter.paintOver(cells)
    expect(context.fills.slice(0, 3)).toEqual([0, 20, 40].map(x => ({
      style: 'rgb(0,0,255)', x, y: 0, width: 10, height: 12,
    })))
    expect(context.fills).toHaveLength(5) // then the two block regions
  })

  it('retains individual translucent fills', () => {
    const { context, painter } = harness(3)
    painter.paintOver(grid([0x20, 0x20, 0x20], [1, 0, 0, 1], [0, 0, 1, 0.5]))
    expect(context.fills).toEqual([0, 10, 20].map(x => ({
      style: 'rgba(0,0,255,0.5)', x, y: 0, width: 10, height: 12,
    })))
  })

  it.each([[1.25, 3], [1.5, 1], [2.05, 3]])(
    'uses actual device edges at scale %s (%s fills)', (dpr, count) => {
      const { context, painter } = harness(3, 1, dpr)
      painter.paintOver(grid([0x20, 0x20, 0x20]))
      expect(context.fills).toHaveLength(count)
    },
  )

  it('keeps bottom-flush runs separate and extends the final column to the edge', () => {
    const { context, painter } = harness(4)
    painter.setViewport(43, 17, 43, 17)
    const cells = grid([0x20, 0x20, 0x20, 0x20])
    cells.attrs.set([0, 0, 0x40, 0x40])
    painter.paintOver(cells)
    expect(context.fills).toEqual([
      { style: 'rgb(0,0,255)', x: 0, y: 0, width: 20, height: 17 },
      { style: 'rgb(0,0,255)', x: 20, y: 5, width: 23, height: 12 },
    ])
  })

  it('falls back when vertical edges are fractional, even with aligned columns', () => {
    const { context, painter } = harness(3)
    painter.setViewport(30, 19, 30, 17)
    const cells = grid([0x20, 0x20, 0x20])
    cells.attrs.fill(0x40)
    painter.paintOver(cells)
    expect(context.fills).toEqual([0, 10, 20].map(x => ({
      style: 'rgb(0,0,255)', x, y: 5, width: 10, height: 12,
    })))
  })

  it('finishes every background before drawing wide or decorated glyphs', () => {
    const { context, painter } = harness(2, 2)
    const events: string[] = []
    const fillRect = context.fillRect.bind(context)
    context.fillRect = (...args) => { events.push('rect'); fillRect(...args) }
    context.fillText = () => { events.push('text') }
    const cells = { ...grid([0x754c, 0x20, 0x41, 0x42]), width: 2, height: 2 }
    cells.attrs[3] = 0x88
    painter.paintOver(cells)
    expect(events).toEqual(['rect', 'rect', 'text', 'text', 'text', 'rect', 'rect'])
  })
})
