// Generic worker boilerplate. Each kernel-specific worker imports this and
// calls runWorker(kernelFn). Output mode is chosen by the main thread via
// the init message:
//   ansi  — worker encodes the cell grid as ANSI escape bytes (default).
//           Used by terminal-emulator variants (ghostty / xterm).
//   cells — worker transfers raw cell-grid typed-array buffers. Used by
//           the canvas painter variants (2d, gl, gpu).

import {
  OpentuiBuffer,
  encodeBufferAsAnsiBytes,
  encodeBufferAsAnsiDiffBytes,
  loadOpentui,
  snapshotBufferTransferable,
} from 'opentui-browser'
import type { OpentuiExports } from 'opentui-browser'

export type WorkerKernel = (buf: OpentuiBuffer, t: number, frame: number, opentui: OpentuiExports) => void
export type WorkerInputHandler = (data: string) => void
export type EncoderMode = 'full' | 'diff'
export type OutputMode = 'ansi' | 'cells'

type FrameReq = { type: 'frame'; t: number; seq: number; clearScreen?: boolean }
type ResizeReq = { type: 'resize'; cols: number; rows: number }
type InitReq = { type: 'init'; encoderMode?: EncoderMode; outputMode?: OutputMode }
type InputReq = { type: 'input'; data: string }
type DisposeReq = { type: 'dispose' }
type InReq = FrameReq | ResizeReq | InitReq | InputReq | DisposeReq

type AnsiFrameReply = { type: 'frame'; mode: 'ansi'; seq: number; bytes: ArrayBufferLike; computeMs: number }
type CellsFrameReply = {
  type: 'frame'
  mode: 'cells'
  seq: number
  cells: {
    width: number
    height: number
    chars: ArrayBufferLike
    fg: ArrayBufferLike
    bg: ArrayBufferLike
    attrs: ArrayBufferLike
  }
  computeMs: number
}
type ReadyReply = { type: 'ready' }
type ErrorReply = { type: 'error'; message: string }
type OutReply = AnsiFrameReply | CellsFrameReply | ReadyReply | ErrorReply

declare const self: {
  onmessage: ((e: MessageEvent<InReq>) => void) | null
  postMessage: (msg: OutReply, transfer?: Transferable[]) => void
}

export function runWorker(kernel: WorkerKernel, onInput?: WorkerInputHandler) {
  let opentui: OpentuiExports | null = null
  let buf: OpentuiBuffer | null = null
  let firstFrame = true
  let frame = 0
  let encoderMode: EncoderMode = 'full'
  let outputMode: OutputMode = 'ansi'

  function post(msg: OutReply, transfer?: Transferable[]) {
    if (transfer) self.postMessage(msg, transfer)
    else self.postMessage(msg)
  }

  self.onmessage = async (e: MessageEvent<InReq>) => {
    const msg = e.data
    try {
      if (msg.type === 'init') {
        opentui = await loadOpentui()
        encoderMode = msg.encoderMode ?? 'full'
        outputMode = msg.outputMode ?? 'ansi'
        post({ type: 'ready' })
      } else if (msg.type === 'resize') {
        if (!opentui) return
        if (!buf) {
          buf = OpentuiBuffer.create(opentui, msg.cols, msg.rows, { id: 'worker', widthMethod: 'unicode' })
          buf.clear([0, 0, 0, 1])
          firstFrame = true
          frame = 0
        } else if (msg.cols !== buf.width || msg.rows !== buf.height) {
          buf.resize(msg.cols, msg.rows)
          buf.clear([0, 0, 0, 1])
          firstFrame = true
          frame = 0
        }
      } else if (msg.type === 'frame') {
        if (!buf || !opentui) return
        const start = performance.now()
        kernel(buf, msg.t, frame, opentui)
        if (outputMode === 'cells') {
          const snap = snapshotBufferTransferable(buf)
          firstFrame = false
          frame++
          const computeMs = performance.now() - start
          post(
            { type: 'frame', mode: 'cells', seq: msg.seq, cells: snap, computeMs },
            [snap.chars, snap.fg, snap.bg, snap.attrs],
          )
        } else {
          const bytes = encoderMode === 'diff'
            ? encodeBufferAsAnsiDiffBytes(buf, { clearScreen: msg.clearScreen ?? firstFrame })
            : encodeBufferAsAnsiBytes(buf, { clearScreen: msg.clearScreen ?? firstFrame })
          firstFrame = false
          frame++
          const computeMs = performance.now() - start
          post({ type: 'frame', mode: 'ansi', seq: msg.seq, bytes: bytes.buffer, computeMs }, [bytes.buffer])
        }
      } else if (msg.type === 'input') {
        onInput?.(msg.data)
      } else if (msg.type === 'dispose') {
        buf?.destroy()
        buf = null
        opentui = null
      }
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
    }
  }
}
