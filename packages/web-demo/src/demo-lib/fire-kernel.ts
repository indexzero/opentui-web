import type { OpentuiBuffer, RGBA } from 'opentui-browser'

const UPPER_HALF_BLOCK = 0x2580
const BLACK: RGBA = [0, 0, 0, 1]

const PALETTE: [number, number, number][] = (() => {
  const p: [number, number, number][] = []
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let r = 0, g = 0, b = 0
    if (t < 0.25) { r = (t / 0.25) * 80; g = 0; b = 0 }
    else if (t < 0.5) { const k = (t - 0.25) / 0.25; r = 80 + k * 175; g = k * 80; b = 0 }
    else if (t < 0.75) { const k = (t - 0.5) / 0.25; r = 255; g = 80 + k * 175; b = k * 60 }
    else { const k = (t - 0.75) / 0.25; r = 255; g = 255; b = 60 + k * 195 }
    p.push([r / 255, g / 255, b / 255])
  }
  return p
})()

// Closure-encapsulated state. Used in both main-thread and worker contexts.
export function createFireDraw(): (buf: OpentuiBuffer, t: number, frame: number) => void {
  let field: Uint8Array | null = null
  let fieldCols = 0
  let fieldRows = 0

  return (buf, _t, _frame) => {
    const cols = buf.width
    const rows = buf.height
    const fCols = cols
    const fRows = rows * 2
    if (!field || fieldCols !== fCols || fieldRows !== fRows) {
      field = new Uint8Array(fCols * fRows)
      fieldCols = fCols
      fieldRows = fRows
    }

    // Seed bottom row with hot pixels.
    for (let x = 0; x < fCols; x++) {
      field[(fRows - 1) * fCols + x] = Math.random() < 0.85 ? 255 : 0
    }
    // Propagate upward.
    for (let y = 0; y < fRows - 1; y++) {
      for (let x = 0; x < fCols; x++) {
        const below = (y + 1) * fCols
        const left = field[below + (x > 0 ? x - 1 : x)]!
        const center = field[below + x]!
        const right = field[below + (x < fCols - 1 ? x + 1 : x)]!
        const farBelow = y + 2 < fRows ? field[(y + 2) * fCols + x]! : center
        const avg = (left + center + right + farBelow) >> 2
        const decay = 1 + ((Math.random() * 3) | 0)
        const next = avg > decay ? avg - decay : 0
        const dx = (Math.random() * 3) | 0
        field[y * fCols + (x + dx >= fCols ? fCols - 1 : x + dx)] = next
      }
    }

    void BLACK
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const top = field[(y * 2) * fCols + x]!
        const bot = field[(y * 2 + 1) * fCols + x]!
        const fg = PALETTE[top]!
        const bg = PALETTE[bot]!
        buf.setCell(
          x, y, UPPER_HALF_BLOCK,
          [fg[0], fg[1], fg[2], 1],
          [bg[0], bg[1], bg[2], 1],
          0,
        )
      }
    }
  }
}
