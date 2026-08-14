export interface UnitRect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export type BlockElementMask =
  | {
      readonly kind: 'binary'
      readonly foreground: readonly UnitRect[]
      readonly background: readonly UnitRect[]
    }
  | { readonly kind: 'uniform'; readonly coverage: 0.25 | 0.5 | 0.75 }

const rect = (x0: number, y0: number, x1: number, y1: number): UnitRect =>
  Object.freeze({ x0, y0, x1, y1 })

const TOP_LEFT = rect(0, 0, 0.5, 0.5)
const TOP_RIGHT = rect(0.5, 0, 1, 0.5)
const BOTTOM_LEFT = rect(0, 0.5, 0.5, 1)
const BOTTOM_RIGHT = rect(0.5, 0.5, 1, 1)
const QUADRANTS = [TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT] as const

function binary(
  foreground: readonly UnitRect[],
  background: readonly UnitRect[],
): BlockElementMask {
  return Object.freeze({
    kind: 'binary' as const,
    foreground: Object.freeze(foreground),
    background: Object.freeze(background),
  })
}

function splitVertical(foregroundTop: boolean, edge: number): BlockElementMask {
  return foregroundTop
    ? binary([rect(0, 0, 1, edge)], [rect(0, edge, 1, 1)])
    : binary([rect(0, edge, 1, 1)], [rect(0, 0, 1, edge)])
}

function splitHorizontal(foregroundLeft: boolean, edge: number): BlockElementMask {
  return foregroundLeft
    ? binary([rect(0, 0, edge, 1)], [rect(edge, 0, 1, 1)])
    : binary([rect(edge, 0, 1, 1)], [rect(0, 0, edge, 1)])
}

function quadrants(...foregroundIndices: readonly number[]): BlockElementMask {
  const selected = new Set(foregroundIndices)
  return binary(
    QUADRANTS.filter((_, index) => selected.has(index)),
    QUADRANTS.filter((_, index) => !selected.has(index)),
  )
}

const BLOCK_ELEMENTS: readonly BlockElementMask[] = Object.freeze([
  splitVertical(true, 1 / 2), // U+2580 UPPER HALF BLOCK
  splitVertical(false, 7 / 8), // U+2581 LOWER ONE EIGHTH BLOCK
  splitVertical(false, 3 / 4), // U+2582 LOWER ONE QUARTER BLOCK
  splitVertical(false, 5 / 8), // U+2583 LOWER THREE EIGHTHS BLOCK
  splitVertical(false, 1 / 2), // U+2584 LOWER HALF BLOCK
  splitVertical(false, 3 / 8), // U+2585 LOWER FIVE EIGHTHS BLOCK
  splitVertical(false, 1 / 4), // U+2586 LOWER THREE QUARTERS BLOCK
  splitVertical(false, 1 / 8), // U+2587 LOWER SEVEN EIGHTHS BLOCK
  binary([rect(0, 0, 1, 1)], []), // U+2588 FULL BLOCK
  splitHorizontal(true, 7 / 8), // U+2589 LEFT SEVEN EIGHTHS BLOCK
  splitHorizontal(true, 3 / 4), // U+258A LEFT THREE QUARTERS BLOCK
  splitHorizontal(true, 5 / 8), // U+258B LEFT FIVE EIGHTHS BLOCK
  splitHorizontal(true, 1 / 2), // U+258C LEFT HALF BLOCK
  splitHorizontal(true, 3 / 8), // U+258D LEFT THREE EIGHTHS BLOCK
  splitHorizontal(true, 1 / 4), // U+258E LEFT ONE QUARTER BLOCK
  splitHorizontal(true, 1 / 8), // U+258F LEFT ONE EIGHTH BLOCK
  splitHorizontal(false, 1 / 2), // U+2590 RIGHT HALF BLOCK
  Object.freeze({ kind: 'uniform' as const, coverage: 0.25 as const }), // U+2591 LIGHT SHADE
  Object.freeze({ kind: 'uniform' as const, coverage: 0.5 as const }), // U+2592 MEDIUM SHADE
  Object.freeze({ kind: 'uniform' as const, coverage: 0.75 as const }), // U+2593 DARK SHADE
  splitVertical(true, 1 / 8), // U+2594 UPPER ONE EIGHTH BLOCK
  splitHorizontal(false, 7 / 8), // U+2595 RIGHT ONE EIGHTH BLOCK
  quadrants(2), // U+2596 QUADRANT LOWER LEFT
  quadrants(3), // U+2597 QUADRANT LOWER RIGHT
  quadrants(0), // U+2598 QUADRANT UPPER LEFT
  quadrants(0, 2, 3), // U+2599 QUADRANT UPPER LEFT AND LOWER LEFT AND LOWER RIGHT
  quadrants(0, 3), // U+259A QUADRANT UPPER LEFT AND LOWER RIGHT
  quadrants(0, 1, 2), // U+259B QUADRANT UPPER LEFT AND UPPER RIGHT AND LOWER LEFT
  quadrants(0, 1, 3), // U+259C QUADRANT UPPER LEFT AND UPPER RIGHT AND LOWER RIGHT
  quadrants(1), // U+259D QUADRANT UPPER RIGHT
  quadrants(1, 2), // U+259E QUADRANT UPPER RIGHT AND LOWER LEFT
  quadrants(1, 2, 3), // U+259F QUADRANT UPPER RIGHT AND LOWER LEFT AND LOWER RIGHT
])

export function decodeBlockElement(codepoint: number): BlockElementMask | null {
  if (codepoint < 0x2580 || codepoint > 0x259f) return null
  return BLOCK_ELEMENTS[codepoint - 0x2580]!
}
