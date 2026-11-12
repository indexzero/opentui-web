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
  private style: string | CanvasGradient | CanvasPattern = '#000'
  readonly fillStyles: string[] = []
  readonly textStyles: string[] = []

  get fillStyle(): string | CanvasGradient | CanvasPattern { return this.style }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.style = value
    this.fillStyles.push(String(value))
  }
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
    this.textStyles.push(String(this.fillStyle))
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

  it.each([0.9, 1.1, 1.25, 1.5, 1.8, 2.05, 2.2])(
    'merges opaque backgrounds across fractional cell edges at scale %s', dpr => {
      const { context, painter } = harness(3, 1, dpr)
      painter.paintOver(grid([0x20, 0x20, 0x20]))
      expect(context.fills).toHaveLength(1)
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

  it('snaps the bottom-flush band to device rows at fractional vertical scale', () => {
    const { context, painter } = harness(3)
    painter.setViewport(30, 19, 30, 17)
    const cells = grid([0x20, 0x20, 0x20])
    cells.attrs.fill(0x40)
    painter.paintOver(cells)
    expect(context.fills).toHaveLength(1)
    const fill = context.fills[0]!
    expect(fill.y * 19 / 17).toBeCloseTo(6)
    expect((fill.y + fill.height) * 19 / 17).toBeCloseTo(19)
    expect(fill.width).toBe(30)
  })

  it.each([0.9, 1.1, 1.25, 1.8, 2.2, 2.625])(
    'tiles translucent and differently colored cells without gaps or overlap at scale %s', dpr => {
      const { context, painter } = harness(4, 2, dpr)
      const cssW = 43.25, cssH = 27.5
      const deviceW = Math.round(cssW * dpr), deviceH = Math.round(cssH * dpr)
      painter.setViewport(deviceW, deviceH, cssW, cssH)
      const cells = { ...grid(Array(8).fill(0x20), [0, 0, 0, 0], [0, 0, 1, 0.5]), width: 4, height: 2 }
      for (let i = 1; i < 8; i += 2) cells.bg.set([1, 0, 0, 0.5], i * 4)
      painter.paintOver(cells)
      expect(context.fills).toHaveLength(8)
      const sx = deviceW / cssW, sy = deviceH / cssH
      const edges = context.fills.map(f => ({
        left: f.x * sx, right: (f.x + f.width) * sx,
        top: f.y * sy, bottom: (f.y + f.height) * sy,
      }))
      for (const edge of edges) for (const value of Object.values(edge)) {
        expect(value).toBeCloseTo(Math.round(value), 10)
      }
      for (let y = 0; y < 2; y++) {
        expect(edges[y * 4]!.left).toBe(0)
        expect(edges[y * 4 + 3]!.right).toBeCloseTo(deviceW)
        for (let x = 1; x < 4; x++) expect(edges[y * 4 + x]!.left).toBeCloseTo(edges[y * 4 + x - 1]!.right)
      }
      for (let x = 0; x < 4; x++) {
        expect(edges[x]!.top).toBe(0)
        expect(edges[x]!.bottom).toBeCloseTo(edges[4 + x]!.top)
        expect(edges[4 + x]!.bottom).toBeCloseTo(deviceH)
      }
    },
  )

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


describe('CanvasPainter numeric color state', () => {
  it('reuses quantized RGB and opaque alpha without changing source colors', () => {
    const { context, painter } = harness(4)
    const cells = grid([0x41, 0x42, 0x43, 0x44], [0.5, 0.25, 0.75, 1], [0, 0, 0, 0])
    cells.fg.set([0.5001, 0.2501, 0.7501, 2], 4)
    cells.fg.set([0.5002, 0.2502, 0.7502, Infinity], 8)
    const before = cells.fg.slice()
    painter.paintOver(cells)
    expect(context.fillStyles).toEqual(['rgb(127,63,191)'])
    expect(context.textStyles).toEqual(Array(4).fill('rgb(127,63,191)'))
    expect(cells.fg).toEqual(before)
  })

  it('keeps alpha precision, signed-zero equality, and invalid-alpha string equality', () => {
    const alphas = [0.50001, 0.50001, 0.50002, 0, -0, -0.25, NaN, NaN, 1, 2]
    const { context, painter } = harness(alphas.length)
    const cells = grid(Array(alphas.length).fill(0x41), [1, 0, 0, 1], [0, 0, 0, 0])
    for (let i = 0; i < alphas.length; i++) cells.fg[i * 4 + 3] = alphas[i]!
    const expected = alphas.map((_, i) => {
      const alpha = cells.fg[i * 4 + 3]!
      return alpha >= 1 ? 'rgb(255,0,0)' : `rgba(255,0,0,${alpha})`
    })
    painter.paintOver(cells)
    expect(context.textStyles).toEqual(expected)
    expect(context.fillStyles).toEqual(expected.filter((style, i) => style !== expected[i - 1]))
    expect(context.fillStyles[0]).not.toBe('rgba(255,0,0,0.5)')
  })

  it('does not alias out-of-range channels to an eight-bit packed RGB key', () => {
    const { context, painter } = harness(3)
    const cells = grid([0x41, 0x42, 0x43], [1, 0, 0, 1], [0, 0, 0, 0])
    cells.fg.set([0, 1 / 255, 0, 1], 0)
    cells.fg.set([0, 0, 256 / 255, 1], 4)
    cells.fg.set([0, 0, -1 / 255, 1], 8)
    painter.paintOver(cells)
    expect(context.textStyles).toEqual(['rgb(0,1,0)', 'rgb(0,0,256)', 'rgb(0,0,-1)'])
  })

  it('compares translucent backgrounds after quantization without merging their fills', () => {
    const { context, painter } = harness(5)
    const cells = grid(Array(5).fill(0x20), [1, 0, 0, 1], [0.5, 0, 0, 0.50001])
    cells.bg[4] = 0.5001
    cells.bg[11] = 0 // skip does not change state
    cells.bg[19] = 0.50002
    painter.paintOver(cells)
    const a = cells.bg[3]!, b = cells.bg[19]!
    expect(context.fillStyles).toEqual([`rgba(127,0,0,${a})`, `rgba(127,0,0,${b})`])
    expect(context.fills.map(fill => fill.x)).toEqual([0, 10, 30, 40])
  })

  it('starts foreground state independently of the final background state', () => {
    const { context, painter } = harness(2)
    painter.paintOver(grid([0x41, 0x42], [1, 0, 0, 1], [1, 0, 0, 1]))
    expect(context.fillStyles).toEqual(['rgb(255,0,0)', 'rgb(255,0,0)'])
    expect(context.textStyles).toEqual(['rgb(255,0,0)', 'rgb(255,0,0)'])
  })

  it.each([0, 0x88])('restores text and decoration color after a shade block with attrs %s', attrs => {
    const { context, painter } = harness(3)
    const cells = grid([0x41, 0x2591, 0x42], [1, 0, 0, 1], [0, 0, 0, 0])
    cells.attrs[1] = attrs
    painter.paintOver(cells)
    expect(context.fillStyles).toEqual(['rgb(255,0,0)', 'rgba(255,0,0,0.25)', 'rgb(255,0,0)'])
    expect(context.textStyles).toEqual(['rgb(255,0,0)', 'rgb(255,0,0)'])
    expect(context.fills.map(fill => fill.style)).toEqual(attrs
      ? ['rgba(255,0,0,0.25)', 'rgb(255,0,0)', 'rgb(255,0,0)']
      : ['rgba(255,0,0,0.25)'])
  })

  it('restores foreground for decorated spaces and resets state on every paint', () => {
    const { context, painter } = harness(3)
    const cells = grid([0x41, 0x20, 0x42], [1, 0, 0, 0.5], [0, 0, 0, 0])
    cells.attrs[1] = 0x88
    cells.fg.set([0, 1, 0, 0.5], 4)
    painter.paintOver(cells)
    context.fillStyle = '#123456' // another layer may draw between frames
    painter.paintOver(cells)
    expect(context.fillStyles).toEqual([
      'rgba(255,0,0,0.5)', 'rgba(0,255,0,0.5)', 'rgba(255,0,0,0.5)', '#123456',
      'rgba(255,0,0,0.5)', 'rgba(0,255,0,0.5)', 'rgba(255,0,0,0.5)',
    ])
    expect(context.fills.map(fill => fill.style)).toEqual(Array(4).fill('rgba(0,255,0,0.5)'))
  })
})
