// Stopgap JS-side ANSI encoder: reads an opentui cell grid and emits escape
// sequences a terminal emulator (ghostty-web / xterm.js) can render.
//
// This will be replaced by `renderer.zig`'s native ANSI emission once
// `lib-wasm.zig` is widened to include the renderer. The interface (a buffer
// snapshot → string of escape sequences) stays the same either way.
//
// The hot path was simplified to (a) work in raw 0–255 ints rather than RGBA
// tuples, (b) carry SGR state across row boundaries instead of resetting at
// every \r\n, and (c) avoid all per-cell array allocation.

import type { OpentuiBuffer } from './buffer'

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
  let out = opts.clearScreen ?? true ? '\x1b[H\x1b[2J' : '\x1b[H'

  let lastFgR = -1, lastFgG = -1, lastFgB = -1
  let lastBgR = -1, lastBgG = -1, lastBgB = -1
  let lastAttrs = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const ai = attrs[i]! & 0xff // strip link-id bits
      const ch = chars[i]!
      const fi = i * 4

      const fr = (fg[fi]! * 255) | 0
      const fgg = (fg[fi + 1]! * 255) | 0
      const fb = (fg[fi + 2]! * 255) | 0
      const br = (bg[fi]! * 255) | 0
      const bgg = (bg[fi + 1]! * 255) | 0
      const bb = (bg[fi + 2]! * 255) | 0

      if (ai !== lastAttrs) {
        out += '\x1b[0m'
        if (ai & ATTR_BOLD) out += '\x1b[1m'
        if (ai & ATTR_DIM) out += '\x1b[2m'
        if (ai & ATTR_ITALIC) out += '\x1b[3m'
        if (ai & ATTR_UNDERLINE) out += '\x1b[4m'
        if (ai & ATTR_INVERSE) out += '\x1b[7m'
        lastAttrs = ai
        // \x1b[0m reset wipes color state — must re-emit on next change.
        lastFgR = lastFgG = lastFgB = -1
        lastBgR = lastBgG = lastBgB = -1
      }

      if (fr !== lastFgR || fgg !== lastFgG || fb !== lastFgB) {
        out += `\x1b[38;2;${fr};${fgg};${fb}m`
        lastFgR = fr
        lastFgG = fgg
        lastFgB = fb
      }
      if (br !== lastBgR || bgg !== lastBgG || bb !== lastBgB) {
        out += `\x1b[48;2;${br};${bgg};${bb}m`
        lastBgR = br
        lastBgG = bgg
        lastBgB = bb
      }

      if (ch === 0 || ch > 0x10ffff) out += ' '
      else if (ch < 0x80) out += String.fromCharCode(ch)
      else out += String.fromCodePoint(ch)
    }
    // Keep SGR state across rows: do NOT \x1b[0m here. The terminal preserves it.
    out += '\r\n'
  }
  // Reset SGR at end of frame so the row below the canvas doesn't inherit the
  // last cell's background color across redraws.
  out += '\x1b[0m'
  return out
}
