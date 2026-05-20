import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { useOpentuiTerminal } from '../demo-lib/useOpentuiTerminal'
import { DemoFrame } from '../demo-lib/DemoLayout'
import type { RGBA } from 'opentui-browser'

export const Route = createFileRoute('/counter')({ component: Counter })

const COLS = 60
const ROWS = 14
const BG: RGBA = [0.04, 0.04, 0.07, 1]

// 5x7 glyph font for 0-9 — one bit per pixel, MSB = leftmost.
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

function Counter() {
  const [count, setCount] = useState(0)
  const countRef = useRef(count)
  countRef.current = count

  useEffect(() => {
    // Real React state updates driving an opentui-rendered scene. Mirrors
    // opentui's own packages/react/examples/counter.tsx.
    const id = window.setInterval(() => setCount((c) => c + 1), 50)
    return () => window.clearInterval(id)
  }, [])

  const { hostRef, status, error, fps } = useOpentuiTerminal({
    cols: COLS,
    rows: ROWS,
    hideCursor: true,
    background: '#0b0b14',
    draw: ({ buf, t }) => {
      buf.clear(BG)
      const text = String(countRef.current)
      const glyphW = FONT_W + 1
      const startX = Math.floor((COLS - text.length * glyphW) / 2)
      const startY = Math.floor((ROWS - FONT_H) / 2)

      // Color pulses with time so you can see the redraw cadence even when count stops.
      const hue = (t * 60) % 360
      const rgb = hsv(hue, 0.55, 1)
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

      const label = ' React useState -> opentui WASM '
      for (let i = 0; i < label.length; i++) {
        buf.setCell(
          Math.floor((COLS - label.length) / 2) + i,
          startY + FONT_H + 2,
          label.charCodeAt(i),
          [0.7, 0.74, 0.86, 1],
          BG,
          0,
        )
      }
    },
  })

  return (
    <DemoFrame
      title="counter"
      subtitle={`React setState driving opentui · ${count}`}
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}

function hsv(h: number, s: number, v: number): [number, number, number] {
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
