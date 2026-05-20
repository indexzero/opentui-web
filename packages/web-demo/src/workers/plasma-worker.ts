// Worker that owns the opentui WASM + OpentuiBuffer + plasma kernel.
// The main thread sends frame requests; the worker computes pixels, encodes
// ANSI, and transfers a Uint8Array's underlying buffer back. ghostty-web on
// the main thread receives the bytes and parses+paints — so worker and main
// run in parallel (worker = compute, main = parse + paint).

import { OpentuiBuffer, encodeBufferAsAnsiBytes, hsv, loadOpentui } from 'opentui-browser'
import type { OpentuiExports, RGBA } from 'opentui-browser'

const UPPER_HALF_BLOCK = 0x2580

type FrameReq = { type: 'frame'; t: number; seq: number; clearScreen?: boolean }
type ResizeReq = { type: 'resize'; cols: number; rows: number }
type InitReq = { type: 'init' }
type DisposeReq = { type: 'dispose' }
type InReq = FrameReq | ResizeReq | InitReq | DisposeReq

type FrameReply = { type: 'frame'; seq: number; bytes: ArrayBufferLike; computeMs: number }
type ReadyReply = { type: 'ready' }
type ErrorReply = { type: 'error'; message: string }
type OutReply = FrameReply | ReadyReply | ErrorReply

// Worker scope — declared inline so we don't need to widen tsconfig lib.
declare const self: {
  onmessage: ((e: MessageEvent<InReq>) => void) | null
  postMessage: (msg: OutReply, transfer?: Transferable[]) => void
}

let opentui: OpentuiExports | null = null
let buf: OpentuiBuffer | null = null
let firstFrame = true

function plasmaAt(px: number, py: number, t: number, cols: number, rows: number): [number, number, number] {
  const dx = px - cols / 2
  const dy = py - rows
  const r = Math.sqrt(dx * dx + dy * dy)
  const v =
    Math.sin(px * 0.09 + t * 1.3) +
    Math.sin(py * 0.13 + t * 1.1) +
    Math.sin((px + py) * 0.06 + t * 0.7) +
    Math.sin(r * 0.18 + t * 1.7)
  return hsv(v * 60 + t * 40, 0.85, 0.95)
}

function drawPlasma(buf: OpentuiBuffer, t: number) {
  const cols = buf.width
  const rows = buf.height
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const top = plasmaAt(x, y * 2, t, cols, rows)
      const bot = plasmaAt(x, y * 2 + 1, t, cols, rows)
      const fg: RGBA = [top[0], top[1], top[2], 1]
      const bg: RGBA = [bot[0], bot[1], bot[2], 1]
      buf.setCell(x, y, UPPER_HALF_BLOCK, fg, bg, 0)
    }
  }
}

function post(msg: OutReply, transfer?: Transferable[]) {
  if (transfer) self.postMessage(msg, transfer)
  else self.postMessage(msg)
}

// Diagnostic: announce existence before any message round-trip.
post({ type: 'ready' })

self.onmessage = async (e: MessageEvent<InReq>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      opentui = await loadOpentui()
      post({ type: 'ready' })
    } else if (msg.type === 'resize') {
      if (!opentui) return
      if (!buf) {
        buf = OpentuiBuffer.create(opentui, msg.cols, msg.rows, { id: 'plasma-worker', widthMethod: 'unicode' })
        buf.clear([0, 0, 0, 1])
        firstFrame = true
      } else if (msg.cols !== buf.width || msg.rows !== buf.height) {
        buf.resize(msg.cols, msg.rows)
        buf.clear([0, 0, 0, 1])
        firstFrame = true
      }
    } else if (msg.type === 'frame') {
      if (!buf) return
      const start = performance.now()
      drawPlasma(buf, msg.t)
      const bytes = encodeBufferAsAnsiBytes(buf, { clearScreen: msg.clearScreen ?? firstFrame })
      firstFrame = false
      const computeMs = performance.now() - start
      // Transfer the underlying buffer back to main thread (zero-copy).
      post({ type: 'frame', seq: msg.seq, bytes: bytes.buffer, computeMs }, [bytes.buffer])
    } else if (msg.type === 'dispose') {
      buf?.destroy()
      buf = null
      opentui = null
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
  }
}

export {}
