// Shared wire format for cell-grid renderers.
//
// All canvas painters (2d, WebGL, WebGPU) consume this. The arrays are the
// same shape opentui's OptimizedBuffer exposes via its getXxxPtr exports —
// just typed-array views so they can be passed between main thread, workers,
// and painters without copying when allocated outside wasm memory.

import type { OpentuiBuffer } from './buffer'

export interface CellGrid {
  width: number
  height: number
  chars: Uint32Array
  fg: Float32Array // 4 floats per cell, RGBA
  bg: Float32Array
  attrs: Uint32Array
}

// Pull a CellGrid snapshot from an OpentuiBuffer. The returned arrays are
// views over wasm memory — do not retain across allocations.
export function snapshotBuffer(buf: OpentuiBuffer): CellGrid {
  const s = buf.snapshot()
  return s
}

// Copy an OpentuiBuffer's cells into freshly-allocated transferable
// ArrayBuffers. Suitable for postMessage(... , [chars.buffer, fg.buffer, ...]).
export function snapshotBufferTransferable(buf: OpentuiBuffer): {
  width: number
  height: number
  chars: ArrayBuffer
  fg: ArrayBuffer
  bg: ArrayBuffer
  attrs: ArrayBuffer
} {
  const s = buf.snapshot()
  const chars = new Uint32Array(s.chars.length)
  chars.set(s.chars)
  const fg = new Float32Array(s.fg.length)
  fg.set(s.fg)
  const bg = new Float32Array(s.bg.length)
  bg.set(s.bg)
  const attrs = new Uint32Array(s.attrs.length)
  attrs.set(s.attrs)
  return {
    width: s.width,
    height: s.height,
    chars: chars.buffer,
    fg: fg.buffer,
    bg: bg.buffer,
    attrs: attrs.buffer,
  }
}

// Format a cell grid as plain text — one line per row, trailing spaces
// trimmed. Powers the canvas-variant Cmd+C "copy visible" handler.
export function gridToText(grid: CellGrid): string {
  const out: string[] = []
  for (let y = 0; y < grid.height; y++) {
    let line = ''
    for (let x = 0; x < grid.width; x++) {
      const cp = grid.chars[y * grid.width + x] ?? 0x20
      line += cp === 0 || cp > 0x10ffff ? ' ' : String.fromCodePoint(cp)
    }
    out.push(line.replace(/ +$/, ''))
  }
  return out.join('\n').replace(/\n+$/, '\n')
}

export function gridFromMessage(msg: {
  width: number
  height: number
  chars: ArrayBuffer
  fg: ArrayBuffer
  bg: ArrayBuffer
  attrs: ArrayBuffer
}): CellGrid {
  return {
    width: msg.width,
    height: msg.height,
    chars: new Uint32Array(msg.chars),
    fg: new Float32Array(msg.fg),
    bg: new Float32Array(msg.bg),
    attrs: new Uint32Array(msg.attrs),
  }
}
