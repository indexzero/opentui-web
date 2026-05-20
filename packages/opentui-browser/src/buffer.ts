// Thin TS wrapper over opentui's OptimizedBuffer exposed through the WASM module.
//
// Allocates linear-memory scratch slots up front and reuses them across calls so
// hot operations (clear / setCell / drawText) don't churn the wasm allocator.

import type { OpentuiExports } from './wasm'

const RGBA_BYTES = 16

export type RGBA = readonly [number, number, number, number]

const encoder = new TextEncoder()

export class OpentuiBuffer {
  readonly width: number
  readonly height: number

  // scratch slots in WASM linear memory
  private readonly fgScratch: number
  private readonly bgScratch: number
  private textScratchPtr = 0
  private textScratchLen = 0

  private constructor(
    readonly mod: OpentuiExports,
    readonly ptr: number,
    width: number,
    height: number,
  ) {
    this.width = width
    this.height = height
    this.fgScratch = mod.opentuiAlloc(RGBA_BYTES)
    this.bgScratch = mod.opentuiAlloc(RGBA_BYTES)
  }

  static create(
    mod: OpentuiExports,
    width: number,
    height: number,
    opts: { id?: string; respectAlpha?: boolean; widthMethod?: 'wcwidth' | 'unicode' } = {},
  ): OpentuiBuffer {
    const id = opts.id ?? 'opentui-browser'
    const idBytes = encoder.encode(id)
    const idPtr = mod.opentuiAlloc(idBytes.length)
    new Uint8Array(mod.memory.buffer, idPtr, idBytes.length).set(idBytes)
    const ptr = mod.createOptimizedBuffer(
      width,
      height,
      opts.respectAlpha ?? false,
      opts.widthMethod === 'unicode' ? 1 : 0,
      idPtr,
      idBytes.length,
    )
    mod.opentuiFree(idPtr, idBytes.length)
    if (ptr === 0) throw new Error('opentui: createOptimizedBuffer returned null')
    return new OpentuiBuffer(mod, ptr, width, height)
  }

  destroy() {
    this.mod.opentuiFree(this.fgScratch, RGBA_BYTES)
    this.mod.opentuiFree(this.bgScratch, RGBA_BYTES)
    if (this.textScratchLen) this.mod.opentuiFree(this.textScratchPtr, this.textScratchLen)
    this.mod.destroyOptimizedBuffer(this.ptr)
  }

  clear(bg: RGBA) {
    writeRGBA(this.mod, this.bgScratch, bg)
    this.mod.bufferClear(this.ptr, this.bgScratch)
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return
    this.mod.bufferResize(this.ptr, width, height)
    ;(this as { -readonly [K in keyof OpentuiBuffer]: OpentuiBuffer[K] }).width = width
    ;(this as { -readonly [K in keyof OpentuiBuffer]: OpentuiBuffer[K] }).height = height
  }

  setCell(x: number, y: number, char: number, fg: RGBA, bg: RGBA, attributes = 0) {
    writeRGBA(this.mod, this.fgScratch, fg)
    writeRGBA(this.mod, this.bgScratch, bg)
    this.mod.bufferSetCell(this.ptr, x, y, char, this.fgScratch, this.bgScratch, attributes)
  }

  drawText(text: string, x: number, y: number, fg: RGBA, attributes = 0) {
    const bytes = encoder.encode(text)
    this.ensureTextScratch(bytes.length)
    new Uint8Array(this.mod.memory.buffer, this.textScratchPtr, bytes.length).set(bytes)
    writeRGBA(this.mod, this.fgScratch, fg)
    this.mod.bufferDrawText(this.ptr, this.textScratchPtr, bytes.length, x, y, this.fgScratch, attributes)
  }

  // Snapshot of the cell grid. Returns fresh views — do not retain across allocations,
  // since wasm memory may move when it grows.
  snapshot() {
    return {
      width: this.width,
      height: this.height,
      chars: new Uint32Array(
        this.mod.memory.buffer,
        this.mod.bufferGetCharPtr(this.ptr),
        this.width * this.height,
      ),
      fg: new Float32Array(
        this.mod.memory.buffer,
        this.mod.bufferGetFgPtr(this.ptr),
        this.width * this.height * 4,
      ),
      bg: new Float32Array(
        this.mod.memory.buffer,
        this.mod.bufferGetBgPtr(this.ptr),
        this.width * this.height * 4,
      ),
      attrs: new Uint32Array(
        this.mod.memory.buffer,
        this.mod.bufferGetAttributesPtr(this.ptr),
        this.width * this.height,
      ),
    }
  }

  private ensureTextScratch(len: number) {
    if (len <= this.textScratchLen) return
    if (this.textScratchLen) this.mod.opentuiFree(this.textScratchPtr, this.textScratchLen)
    this.textScratchPtr = this.mod.opentuiAlloc(len)
    this.textScratchLen = len
  }
}

function writeRGBA(mod: OpentuiExports, ptr: number, color: RGBA) {
  new Float32Array(mod.memory.buffer, ptr, 4).set(color)
}
