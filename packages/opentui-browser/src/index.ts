// Core entry point — wasm + buffer + edit-buffer + ansi + draw helpers.
// Deliberately does NOT re-export from ./layout because that pulls yoga-layout,
// which has a module-level `await loadYoga()` that has problems in some
// environments (we hit it from a Worker). Consumers who want layout should
// import from '@indexzero/opentui-browser/layout' directly.

export { loadOpentui } from './wasm.js'
export type { OpentuiExports } from './wasm.js'
export { OpentuiBuffer } from './buffer.js'
export type { RGBA } from './buffer.js'
export { OpentuiEditBuffer } from './edit-buffer.js'
export type { Cursor } from './edit-buffer.js'
export {
  encodeBufferAsAnsi,
  encodeBufferAsAnsiBytes,
  encodeBufferAsAnsiDiff,
  encodeBufferAsAnsiDiffBytes,
} from './ansi.js'
export type { EncodeOptions } from './ansi.js'
export { drawBar, drawBorder, drawSparkline, drawString, fillRect, hsv } from './draw-helpers.js'
export { CanvasPainter } from './canvas-painter.js'
export type { CanvasPainterOptions } from './canvas-painter.js'
export { CanvasGLPainter } from './canvas-gl-painter.js'
export { CanvasGPUPainter } from './canvas-gpu-painter.js'
export type { CellGrid } from './cell-grid.js'
export { snapshotBuffer, snapshotBufferTransferable, gridFromMessage, gridToText } from './cell-grid.js'
