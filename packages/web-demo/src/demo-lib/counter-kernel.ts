import { hsv } from 'opentui-browser'
import type { OpentuiBuffer, RGBA } from 'opentui-browser'

const BG: RGBA = [0.04, 0.04, 0.07, 1]

const FONT_W = 5
const FONT_H = 7
const DIGITS: Record<string, number[]> = {
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
}
const FULL_BLOCK = 0x2588

// Time-driven so the same kernel renders identically on main thread, worker,
// or canvas. Count increments at 20/sec (same cadence the React version used).
export function drawCounter(buf: OpentuiBuffer, t: number) {
  buf.clear(BG)
  const cols = buf.width
  const rows = buf.height
  const count = Math.floor(t * 20)
  const text = String(count)
  const glyphW = FONT_W + 1
  const startX = Math.floor((cols - text.length * glyphW) / 2)
  const startY = Math.floor((rows - FONT_H) / 2)

  const rgb = hsv((t * 60) % 360, 0.55, 1)
  const fg: RGBA = [rgb[0], rgb[1], rgb[2], 1]

  for (let i = 0; i < text.length; i++) {
    const glyph = DIGITS[text[i]!]
    if (!glyph) continue
    for (let row = 0; row < FONT_H; row++) {
      const bits = glyph[row]!
      for (let col = 0; col < FONT_W; col++) {
        if (bits & (1 << (FONT_W - 1 - col))) {
          buf.setCell(startX + i * glyphW + col, startY + row, FULL_BLOCK, fg, BG, 0)
        }
      }
    }
  }

  const label = ' time-driven counter · same kernel everywhere '
  for (let i = 0; i < label.length; i++) {
    buf.setCell(
      Math.floor((cols - label.length) / 2) + i,
      startY + FONT_H + 2,
      label.charCodeAt(i),
      [0.7, 0.74, 0.86, 1],
      BG,
      0,
    )
  }
}
