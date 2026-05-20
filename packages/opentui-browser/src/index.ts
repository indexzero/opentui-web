// Core entry point — wasm + buffer + edit-buffer + ansi + draw helpers.
// Deliberately does NOT re-export from ./layout because that pulls yoga-layout,
// which has a module-level `await loadYoga()` that has problems in some
// environments (we hit it from a Worker). Consumers who want layout should
// import from 'opentui-browser/layout' directly.

export { loadOpentui } from './wasm'
export type { OpentuiExports } from './wasm'
export { OpentuiBuffer } from './buffer'
export type { RGBA } from './buffer'
export { OpentuiEditBuffer } from './edit-buffer'
export type { Cursor } from './edit-buffer'
export {
  encodeBufferAsAnsi,
  encodeBufferAsAnsiBytes,
  encodeBufferAsAnsiDiff,
  encodeBufferAsAnsiDiffBytes,
} from './ansi'
export type { EncodeOptions } from './ansi'
export { drawBar, drawBorder, drawSparkline, drawString, fillRect, hsv } from './draw-helpers'
export { CanvasPainter } from './canvas-painter'
export type { CanvasPainterOptions } from './canvas-painter'
export { CanvasGLPainter } from './canvas-gl-painter'
export { CanvasGPUPainter } from './canvas-gpu-painter'
export type { CellGrid } from './cell-grid'
export { snapshotBuffer, snapshotBufferTransferable, gridFromMessage, gridToText } from './cell-grid'
