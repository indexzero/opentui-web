import type { OpentuiBuffer, RGBA } from 'opentui-browser'

const GLYPH_LO = 0xff66
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

export function createMatrixDraw(): (buf: OpentuiBuffer, t: number, frame: number) => void {
  let drops: Drop[] | null = null
  let dropsCols = 0

  return (buf, _t, frame) => {
    const cols = buf.width
    const rows = buf.height
    if (!drops || dropsCols !== cols) {
      drops = Array.from({ length: cols }, () => ({
        y: -Math.random() * rows * 2,
        speed: 0.4 + Math.random() * 0.6,
        length: 6 + Math.floor(Math.random() * 12),
        bright: 0.8 + Math.random() * 0.2,
      }))
      dropsCols = cols
    }

    buf.clear(BG)
    for (let x = 0; x < cols; x++) {
      const d = drops[x]!
      d.y += d.speed
      if (d.y - d.length > rows) {
        d.y = -Math.random() * 8
        d.speed = 0.4 + Math.random() * 0.6
        d.length = 6 + Math.floor(Math.random() * 12)
        d.bright = 0.8 + Math.random() * 0.2
      }
      for (let i = 0; i < d.length; i++) {
        const yi = Math.floor(d.y) - i
        if (yi < 0 || yi >= rows) continue
        const isLead = i === 0
        const k = 1 - i / d.length
        const g = isLead ? d.bright : 0.6 * k
        const r = isLead ? d.bright * 0.7 : 0.05 * k
        const b = isLead ? d.bright * 0.8 : 0.15 * k
        const ch = isLead && frame % 3 === 0 ? randomGlyph() : randomGlyph()
        buf.setCell(x, yi, ch, [r, g, b, 1], BG, isLead ? 1 : 0)
      }
    }
  }
}
