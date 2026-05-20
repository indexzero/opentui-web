import { createFileRoute } from '@tanstack/react-router'
import { useOpentuiTerminal } from '../demo-lib/useOpentuiTerminal'
import { DemoFrame } from '../demo-lib/DemoLayout'
import type { RGBA } from 'opentui-browser'

export const Route = createFileRoute('/plasma')({ component: Plasma })

const COLS = 100
const ROWS = 30
const UPPER_HALF_BLOCK = 0x2580

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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

function plasmaAt(px: number, py: number, t: number): [number, number, number] {
  const dx = px - COLS / 2
  const dy = py - ROWS
  const r = Math.sqrt(dx * dx + dy * dy)
  const v =
    Math.sin(px * 0.09 + t * 1.3) +
    Math.sin(py * 0.13 + t * 1.1) +
    Math.sin((px + py) * 0.06 + t * 0.7) +
    Math.sin(r * 0.18 + t * 1.7)
  return hsvToRgb(v * 60 + t * 40, 0.85, 0.95)
}

function Plasma() {
  const { hostRef, status, error, fps } = useOpentuiTerminal({
    cols: COLS,
    rows: ROWS,
    hideCursor: true,
    draw: ({ buf, t }) => {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const top = plasmaAt(x, y * 2, t)
          const bot = plasmaAt(x, y * 2 + 1, t)
          const fg: RGBA = [top[0], top[1], top[2], 1]
          const bg: RGBA = [bot[0], bot[1], bot[2], 1]
          buf.setCell(x, y, UPPER_HALF_BLOCK, fg, bg, 0)
        }
      }
    },
  })

  return (
    <DemoFrame
      title="plasma"
      subtitle="4-sine field · upper-half-block for 2x vertical pixels"
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
