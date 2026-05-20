import type { OpentuiBuffer, RGBA } from 'opentui-browser'
import { hsv } from 'opentui-browser'

export const UPPER_HALF_BLOCK = 0x2580

export function plasmaAt(
  px: number,
  py: number,
  t: number,
  cols: number,
  rows: number,
): [number, number, number] {
  const dx = px - cols / 2
  const dy = py - rows
  const r = Math.sqrt(dx * dx + dy * dy)
  const v =
    Math.sin(px * 0.09 + t * 1.3) +
    Math.sin(py * 0.13 + t * 1.1) +
    Math.sin((px + py) * 0.06 + t * 0.7) +
    Math.sin(r * 0.18 + t * 1.7)
  return hsv(v * 60 + t * 40, 0.85, 0.95)
}

export function drawPlasma(buf: OpentuiBuffer, t: number) {
  const cols = buf.width
  const rows = buf.height
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const top = plasmaAt(x, y * 2, t, cols, rows)
      const bot = plasmaAt(x, y * 2 + 1, t, cols, rows)
      const fg: RGBA = [top[0], top[1], top[2], 1]
      const bg: RGBA = [bot[0], bot[1], bot[2], 1]
      buf.setCell(x, y, UPPER_HALF_BLOCK, fg, bg, 0)
    }
  }
}
