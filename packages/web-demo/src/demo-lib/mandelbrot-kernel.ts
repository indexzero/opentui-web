import type { OpentuiBuffer, RGBA } from 'opentui-browser'
import { hsv } from 'opentui-browser'

export const UPPER_HALF_BLOCK = 0x2580
const MAX_ITER = 96

// A nice landing point in the seahorse valley. Lots of detail at high zoom.
const CENTER_X = -0.743643887037151
const CENTER_Y = 0.131825904205330

function iterate(cx: number, cy: number): number {
  let zx = 0
  let zy = 0
  let iter = 0
  while (iter < MAX_ITER) {
    const zx2 = zx * zx
    const zy2 = zy * zy
    if (zx2 + zy2 > 4) break
    const zxNew = zx2 - zy2 + cx
    zy = 2 * zx * zy + cy
    zx = zxNew
    iter++
  }
  return iter
}

function colorForIter(iter: number, t: number): [number, number, number] {
  if (iter >= MAX_ITER) return [0, 0, 0]
  // Smooth coloring via continuous escape value.
  const v = iter / MAX_ITER
  // Hue rotates with t so the colors breathe even when zoom is paused.
  return hsv(v * 360 + t * 30, 0.7, 0.95)
}

export function drawMandelbrot(buf: OpentuiBuffer, t: number) {
  const cols = buf.width
  const rows = buf.height
  // Animated zoom — exponential into the same point.
  const zoom = Math.exp(t * 0.35) * 0.4
  const aspect = cols / (rows * 2)
  const halfW = 2 / zoom
  const halfH = halfW / aspect

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Two iterations per cell (upper-half-block trick).
      const u = (x + 0.5) / cols
      const cx = CENTER_X + (u - 0.5) * 2 * halfW

      const vT = (y * 2 + 0.5) / (rows * 2)
      const cyT = CENTER_Y + (vT - 0.5) * 2 * halfH
      const top = iterate(cx, cyT)

      const vB = (y * 2 + 1.5) / (rows * 2)
      const cyB = CENTER_Y + (vB - 0.5) * 2 * halfH
      const bot = iterate(cx, cyB)

      const topC = colorForIter(top, t)
      const botC = colorForIter(bot, t)
      const fg: RGBA = [topC[0], topC[1], topC[2], 1]
      const bg: RGBA = [botC[0], botC[1], botC[2], 1]
      buf.setCell(x, y, UPPER_HALF_BLOCK, fg, bg, 0)
    }
  }
}
