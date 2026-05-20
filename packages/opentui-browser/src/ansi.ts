// Stopgap JS-side ANSI encoder: reads an opentui cell grid and emits escape
// sequences a terminal emulator (ghostty-web / xterm.js) can render.
//
// This will be replaced by `renderer.zig`'s native ANSI emission once
// `lib-wasm.zig` is widened to include the renderer. The interface (a buffer
// snapshot → string of escape sequences) stays the same either way.

import type { OpentuiBuffer } from './buffer'

type ColorTuple = readonly [number, number, number, number]

const ATTR_BOLD = 1 << 0
const ATTR_DIM = 1 << 1
const ATTR_ITALIC = 1 << 2
const ATTR_UNDERLINE = 1 << 3
const ATTR_INVERSE = 1 << 5

export interface EncodeOptions {
  // emit cursor-home + clear before drawing. Default true for full-screen redraws.
  clearScreen?: boolean
}

export function encodeBufferAsAnsi(buf: OpentuiBuffer, opts: EncodeOptions = {}): string {
  const { width, height, chars, fg, bg, attrs } = buf.snapshot()
  const out: string[] = []
  if (opts.clearScreen ?? true) out.push('\x1b[H\x1b[2J')

  let lastFg: ColorTuple | null = null
  let lastBg: ColorTuple | null = null
  let lastAttrs = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const ai = attrs[i] ?? 0
      const ch = chars[i] ?? 0x20
      const fg4 = i * 4
      const fgColor: ColorTuple = [fg[fg4] ?? 1, fg[fg4 + 1] ?? 1, fg[fg4 + 2] ?? 1, fg[fg4 + 3] ?? 1]
      const bgColor: ColorTuple = [bg[fg4] ?? 0, bg[fg4 + 1] ?? 0, bg[fg4 + 2] ?? 0, bg[fg4 + 3] ?? 1]

      if (ai !== lastAttrs) {
        out.push('\x1b[0m')
        if (ai & ATTR_BOLD) out.push('\x1b[1m')
        if (ai & ATTR_DIM) out.push('\x1b[2m')
        if (ai & ATTR_ITALIC) out.push('\x1b[3m')
        if (ai & ATTR_UNDERLINE) out.push('\x1b[4m')
        if (ai & ATTR_INVERSE) out.push('\x1b[7m')
        lastAttrs = ai
        lastFg = null
        lastBg = null
      }

      if (!colorEq(fgColor, lastFg)) {
        out.push(sgrColor(true, fgColor))
        lastFg = fgColor
      }
      if (!colorEq(bgColor, lastBg)) {
        out.push(sgrColor(false, bgColor))
        lastBg = bgColor
      }

      out.push(ch === 0 || ch > 0x10ffff ? ' ' : String.fromCodePoint(ch))
    }
    out.push('\x1b[0m\r\n')
    lastAttrs = -1
    lastFg = null
    lastBg = null
  }
  return out.join('')
}

function sgrColor(foreground: boolean, c: ColorTuple): string {
  const r = clamp255(c[0])
  const g = clamp255(c[1])
  const b = clamp255(c[2])
  return `\x1b[${foreground ? 38 : 48};2;${r};${g};${b}m`
}

function clamp255(v: number) {
  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

function colorEq(a: ColorTuple, b: ColorTuple | null): boolean {
  if (!b) return false
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}
