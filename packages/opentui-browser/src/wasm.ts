// WASM loader for opentui.
//
// Resolves opentui.wasm relative to this module via `new URL(..., import.meta.url)`,
// which Vite/Rollup/webpack5 all treat as an asset reference at build time. The
// returned object exposes the typed exports plus the live `memory` for callers
// that need to read cell-grid pointers as ArrayBuffer views.

export interface OpentuiExports {
  memory: WebAssembly.Memory

  opentuiAlloc(len: number): number
  opentuiFree(ptr: number, len: number): void

  createOptimizedBuffer(
    width: number,
    height: number,
    respectAlpha: boolean,
    widthMethod: number,
    idPtr: number,
    idLen: number,
  ): number
  destroyOptimizedBuffer(bufferPtr: number): void

  bufferGetWidth(bufferPtr: number): number
  bufferGetHeight(bufferPtr: number): number
  bufferGetCharPtr(bufferPtr: number): number
  bufferGetFgPtr(bufferPtr: number): number
  bufferGetBgPtr(bufferPtr: number): number
  bufferGetAttributesPtr(bufferPtr: number): number

  bufferClear(bufferPtr: number, bgPtr: number): void
  bufferSetCell(
    bufferPtr: number,
    x: number,
    y: number,
    char: number,
    fgPtr: number,
    bgPtr: number,
    attributes: number,
  ): void
  bufferDrawText(
    bufferPtr: number,
    textPtr: number,
    textLen: number,
    x: number,
    y: number,
    fgPtr: number,
    attributes: number,
  ): void
  bufferResize(bufferPtr: number, width: number, height: number): void
  bufferEncodeAnsi(bufferPtr: number, outPtr: number, outLen: number, clearScreen: boolean): number
  bufferEncodeAnsiDiff(
    bufferPtr: number,
    shadowCharsPtr: number,
    shadowFgPtr: number,
    shadowBgPtr: number,
    shadowAttrsPtr: number,
    outPtr: number,
    outLen: number,
    force: boolean,
  ): number

  createEditBuffer(widthMethod: number): number
  destroyEditBuffer(ebPtr: number): void
  editBufferInsertText(ebPtr: number, textPtr: number, textLen: number): void
  editBufferGetText(ebPtr: number, outPtr: number, maxLen: number): number
  editBufferGetCursor(ebPtr: number, outRowPtr: number, outColPtr: number): void
  editBufferDeleteCharBackward(ebPtr: number): void
  editBufferDeleteChar(ebPtr: number): void
  editBufferMoveCursorLeft(ebPtr: number): void
  editBufferMoveCursorRight(ebPtr: number): void
  editBufferMoveCursorUp(ebPtr: number): void
  editBufferMoveCursorDown(ebPtr: number): void
  editBufferNewLine(ebPtr: number): void
  editBufferGetLineCount(ebPtr: number): number
}

let cached: Promise<OpentuiExports> | null = null

export function loadOpentui(): Promise<OpentuiExports> {
  if (cached) return cached
  const url = new URL('./opentui.wasm', import.meta.url)
  cached = WebAssembly.instantiateStreaming(fetch(url), {})
    .then((r) => r.instance.exports as unknown as OpentuiExports)
    .catch(async () => {
      const bytes = await fetch(url).then((r) => r.arrayBuffer())
      const r = await WebAssembly.instantiate(bytes, {})
      return r.instance.exports as unknown as OpentuiExports
    })
  return cached
}
