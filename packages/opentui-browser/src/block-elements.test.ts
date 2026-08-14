import { describe, expect, it } from 'vitest'

import { decodeBlockElement, type BlockElementMask, type UnitRect } from './block-elements'

const r = (x0: number, y0: number, x1: number, y1: number): UnitRect => ({ x0, y0, x1, y1 })

const expectedForeground: readonly (readonly UnitRect[] | number)[] = [
  [r(0, 0, 1, 1 / 2)],
  [r(0, 7 / 8, 1, 1)],
  [r(0, 3 / 4, 1, 1)],
  [r(0, 5 / 8, 1, 1)],
  [r(0, 1 / 2, 1, 1)],
  [r(0, 3 / 8, 1, 1)],
  [r(0, 1 / 4, 1, 1)],
  [r(0, 1 / 8, 1, 1)],
  [r(0, 0, 1, 1)],
  [r(0, 0, 7 / 8, 1)],
  [r(0, 0, 3 / 4, 1)],
  [r(0, 0, 5 / 8, 1)],
  [r(0, 0, 1 / 2, 1)],
  [r(0, 0, 3 / 8, 1)],
  [r(0, 0, 1 / 4, 1)],
  [r(0, 0, 1 / 8, 1)],
  [r(1 / 2, 0, 1, 1)],
  0.25,
  0.5,
  0.75,
  [r(0, 0, 1, 1 / 8)],
  [r(7 / 8, 0, 1, 1)],
  [r(0, 1 / 2, 1 / 2, 1)],
  [r(1 / 2, 1 / 2, 1, 1)],
  [r(0, 0, 1 / 2, 1 / 2)],
  [r(0, 0, 1 / 2, 1 / 2), r(0, 1 / 2, 1 / 2, 1), r(1 / 2, 1 / 2, 1, 1)],
  [r(0, 0, 1 / 2, 1 / 2), r(1 / 2, 1 / 2, 1, 1)],
  [r(0, 0, 1 / 2, 1 / 2), r(1 / 2, 0, 1, 1 / 2), r(0, 1 / 2, 1 / 2, 1)],
  [r(0, 0, 1 / 2, 1 / 2), r(1 / 2, 0, 1, 1 / 2), r(1 / 2, 1 / 2, 1, 1)],
  [r(1 / 2, 0, 1, 1 / 2)],
  [r(1 / 2, 0, 1, 1 / 2), r(0, 1 / 2, 1 / 2, 1)],
  [r(1 / 2, 0, 1, 1 / 2), r(0, 1 / 2, 1 / 2, 1), r(1 / 2, 1 / 2, 1, 1)],
]

function foreground(mask: BlockElementMask): readonly UnitRect[] | number {
  return mask.kind === 'binary' ? mask.foreground : mask.coverage
}

describe('decodeBlockElement', () => {
  it('enumerates the canonical foreground coverage for every assigned codepoint', () => {
    expect(expectedForeground).toHaveLength(32)
    for (let offset = 0; offset < expectedForeground.length; offset++) {
      expect(foreground(decodeBlockElement(0x2580 + offset)!)).toEqual(expectedForeground[offset])
    }
  })

  it('returns null outside the Block Elements range', () => {
    expect(decodeBlockElement(0x257f)).toBeNull()
    expect(decodeBlockElement(0x25a0)).toBeNull()
  })

  it('returns shared, deeply frozen descriptors instead of allocating in the paint loop', () => {
    for (let codepoint = 0x2580; codepoint <= 0x259f; codepoint++) {
      const first = decodeBlockElement(codepoint)!
      expect(decodeBlockElement(codepoint)).toBe(first)
      expect(Object.isFrozen(first)).toBe(true)
      if (first.kind === 'binary') {
        expect(Object.isFrozen(first.foreground)).toBe(true)
        expect(Object.isFrozen(first.background)).toBe(true)
        for (const rectangle of [...first.foreground, ...first.background]) {
          expect(Object.isFrozen(rectangle)).toBe(true)
        }
      }
    }
  })

  it('partitions every binary cell without overlap or holes', () => {
    for (let codepoint = 0x2580; codepoint <= 0x259f; codepoint++) {
      const mask = decodeBlockElement(codepoint)!
      if (mask.kind !== 'binary') continue
      for (let row = 0; row < 8; row++) {
        for (let column = 0; column < 8; column++) {
          const x = (column + 0.5) / 8
          const y = (row + 0.5) / 8
          const contains = (rectangle: UnitRect) =>
            x >= rectangle.x0 && x < rectangle.x1 && y >= rectangle.y0 && y < rectangle.y1
          const owners = [...mask.foreground, ...mask.background].filter(contains)
          expect(owners, `U+${codepoint.toString(16)} at ${column},${row}`).toHaveLength(1)
        }
      }
    }
  })
})
