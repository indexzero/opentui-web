// Small drawing helpers built on top of opentui-browser primitives. Higher-level
// "panel"-shaped operations a dashboard or layout-heavy scene needs.

import type { OpentuiBuffer, RGBA } from './buffer'

const TL = 0x256d, TR = 0x256e, BL = 0x2570, BR = 0x256f, H = 0x2500, V = 0x2502
const FULL = 0x2588 // █
const SHADE_LIGHT = 0x2591 // ░
const TRANSPARENT: RGBA = [0, 0, 0, 0]

export function fillRect(buf: OpentuiBuffer, x: number, y: number, w: number, h: number, color: RGBA) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      buf.setCell(x + dx, y + dy, 0x20, [1, 1, 1, 1], color, 0)
    }
  }
}

export function drawBorder(
  buf: OpentuiBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGBA,
  title?: string,
) {
  for (let i = 1; i < w - 1; i++) {
    buf.setCell(x + i, y, H, color, TRANSPARENT, 0)
    buf.setCell(x + i, y + h - 1, H, color, TRANSPARENT, 0)
  }
  for (let i = 1; i < h - 1; i++) {
    buf.setCell(x, y + i, V, color, TRANSPARENT, 0)
    buf.setCell(x + w - 1, y + i, V, color, TRANSPARENT, 0)
  }
  buf.setCell(x, y, TL, color, TRANSPARENT, 0)
  buf.setCell(x + w - 1, y, TR, color, TRANSPARENT, 0)
  buf.setCell(x, y + h - 1, BL, color, TRANSPARENT, 0)
  buf.setCell(x + w - 1, y + h - 1, BR, color, TRANSPARENT, 0)
  if (title) {
    drawString(buf, ` ${title} `, x + 2, y, color, TRANSPARENT, 1)
  }
}

export function drawString(
  buf: OpentuiBuffer,
  text: string,
  x: number,
  y: number,
  fg: RGBA,
  bg: RGBA,
  attrs = 0,
) {
  let col = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    buf.setCell(x + col, y, cp, fg, bg, attrs)
    col++
  }
}

export function drawBar(
  buf: OpentuiBuffer,
  x: number,
  y: number,
  w: number,
  value: number, // 0..1
  fg: RGBA,
  trackBg: RGBA,
) {
  const filled = Math.round(value * w)
  for (let i = 0; i < w; i++) {
    if (i < filled) buf.setCell(x + i, y, FULL, fg, trackBg, 0)
    else buf.setCell(x + i, y, SHADE_LIGHT, fg, trackBg, 0)
  }
}

// Vertical sparkline using 8 levels of the lower-block characters.
const SPARK_BLOCKS = [0x20, 0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588]

export function drawSparkline(
  buf: OpentuiBuffer,
  x: number,
  y: number,
  w: number,
  series: ArrayLike<number>, // each 0..1
  fg: RGBA,
  bg: RGBA,
) {
  const start = Math.max(0, series.length - w)
  for (let i = 0; i < w; i++) {
    const v = i + start < series.length ? series[i + start]! : 0
    const idx = Math.max(0, Math.min(8, Math.round(v * 8)))
    buf.setCell(x + i, y, SPARK_BLOCKS[idx]!, fg, bg, 0)
  }
}

export function hsv(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) { r = c; g = x }
  else if (hp < 2) { r = x; g = c }
  else if (hp < 3) { g = c; b = x }
  else if (hp < 4) { g = x; b = c }
  else if (hp < 5) { r = x; b = c }
  else { r = c; b = x }
  const m = v - c
  return [r + m, g + m, b + m]
}
