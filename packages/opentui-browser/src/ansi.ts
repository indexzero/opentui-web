// ANSI emitter — Zig-side now. Reads opentui's cell grid in WASM, walks it,
// emits SGR + cell content into a JS-supplied scratch slot, returns the byte
// range. The JS side just decodes the slice as UTF-8 and hands it to a VT
// emulator. State is carried across rows; trailing \x1b[0m resets at frame
// end so the row below the canvas doesn't inherit a background color.

import type { OpentuiBuffer } from './buffer'
import type { OpentuiExports } from './wasm'

const decoder = new TextDecoder()

export interface EncodeOptions {
  clearScreen?: boolean
}

// Per-WASM-module scratch state. Cell-grid encoding is the hottest path in the
// pipeline, so we keep one growable byte buffer in linear memory and one fresh
// Uint8Array view per call (the buffer can move when wasm memory grows, so we
// re-take the view each frame).
const SCRATCH = new WeakMap<OpentuiExports, { ptr: number; len: number }>()

function scratch(mod: OpentuiExports, need: number) {
  let s = SCRATCH.get(mod)
  if (!s || s.len < need) {
    if (s) mod.opentuiFree(s.ptr, s.len)
    // round up to next 64 KB
    const len = (need + 65535) & ~65535
    const ptr = mod.opentuiAlloc(len)
    s = { ptr, len }
    SCRATCH.set(mod, s)
  }
  return s
}

export function encodeBufferAsAnsi(buf: OpentuiBuffer, opts: EncodeOptions = {}): string {
  // Worst case per cell ≈ 36 bytes (SGR + UTF-8 char). Use 64 bytes as a generous bound.
  const need = buf.width * buf.height * 64 + 64
  const s = scratch(buf.mod, need)
  const written = buf.mod.bufferEncodeAnsi(buf.ptr, s.ptr, s.len, opts.clearScreen ?? true)
  return decoder.decode(new Uint8Array(buf.mod.memory.buffer, s.ptr, written))
}

// Like encodeBufferAsAnsi but returns a fresh Uint8Array backed by its own
// ArrayBuffer. The caller can postMessage() it as a transferable so a worker
// can hand bytes to the main thread with no copy. Slightly slower than the
// string version for same-thread use because of the extra Uint8Array.set().
export function encodeBufferAsAnsiBytes(buf: OpentuiBuffer, opts: EncodeOptions = {}): Uint8Array {
  const need = buf.width * buf.height * 64 + 64
  const s = scratch(buf.mod, need)
  const written = buf.mod.bufferEncodeAnsi(buf.ptr, s.ptr, s.len, opts.clearScreen ?? true)
  const out = new Uint8Array(written)
  out.set(new Uint8Array(buf.mod.memory.buffer, s.ptr, written))
  return out
}
