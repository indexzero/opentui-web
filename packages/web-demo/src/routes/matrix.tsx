import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'
import { useOpentuiTerminal } from '../demo-lib/useOpentuiTerminal'
import { DemoFrame } from '../demo-lib/DemoLayout'
import type { RGBA } from 'opentui-browser'

export const Route = createFileRoute('/matrix')({ component: Matrix })

const COLS = 100
const ROWS = 32
const GLYPH_LO = 0xff66 // half-width Katakana for that authentic look
const GLYPH_HI = 0xff9d
const BG: RGBA = [0, 0, 0, 1]

interface Drop {
  y: number
  speed: number
  length: number
  bright: number
}

function randomGlyph(): number {
  return GLYPH_LO + Math.floor(Math.random() * (GLYPH_HI - GLYPH_LO + 1))
}

function Matrix() {
  // Per-column drop state lives in a ref so React doesn't re-render on every frame.
  const dropsRef = useRef<Drop[] | null>(null)

  const { hostRef, status, error, fps } = useOpentuiTerminal({
    cols: COLS,
    rows: ROWS,
    hideCursor: true,
    draw: ({ buf, frame }) => {
      if (!dropsRef.current) {
        dropsRef.current = Array.from({ length: COLS }, () => ({
          y: -Math.random() * ROWS * 2,
          speed: 0.4 + Math.random() * 0.6,
          length: 6 + Math.floor(Math.random() * 12),
          bright: 0.8 + Math.random() * 0.2,
        }))
      }
      const drops = dropsRef.current

      buf.clear(BG)

      for (let x = 0; x < COLS; x++) {
        const d = drops[x]!
        d.y += d.speed
        if (d.y - d.length > ROWS) {
          d.y = -Math.random() * 8
          d.speed = 0.4 + Math.random() * 0.6
          d.length = 6 + Math.floor(Math.random() * 12)
          d.bright = 0.8 + Math.random() * 0.2
        }
        for (let i = 0; i < d.length; i++) {
          const yi = Math.floor(d.y) - i
          if (yi < 0 || yi >= ROWS) continue
          // Lead char is bright white-green, trail fades to dim green.
          const isLead = i === 0
          const k = 1 - i / d.length
          const g = isLead ? d.bright : 0.6 * k
          const r = isLead ? d.bright * 0.7 : 0.05 * k
          const b = isLead ? d.bright * 0.8 : 0.15 * k
          // Re-roll the lead glyph every few frames for shimmer.
          const ch = isLead && frame % 3 === 0 ? randomGlyph() : randomGlyph()
          buf.setCell(x, yi, ch, [r, g, b, 1], BG, isLead ? 1 : 0)
        }
      }
    },
  })

  return (
    <DemoFrame
      title="matrix"
      subtitle="rain · per-column ref state · half-width katakana glyphs"
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
