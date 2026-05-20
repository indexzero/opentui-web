// Thin TS wrapper over opentui's EditBuffer exposed through the WASM module.
//
// Owns the in/out scratch slots in linear memory so insertText / getText
// don't churn the wasm allocator on every keystroke.

import type { OpentuiExports } from './wasm'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const READ_BUF_BYTES = 1 << 16 // 64 KB read buffer; resized on demand

export interface Cursor {
  row: number
  col: number
}

export class OpentuiEditBuffer {
  // One contiguous 8-byte slot: row at +0, col at +4. Two separate allocs
  // would NOT be adjacent in wasm memory, so a single Uint32Array of length 2
  // over the first one read garbage for the second element.
  private readCursorPtr: number
  private readBufPtr: number
  private readBufLen: number

  private constructor(
    readonly mod: OpentuiExports,
    readonly ptr: number,
  ) {
    this.readCursorPtr = mod.opentuiAlloc(8)
    this.readBufPtr = mod.opentuiAlloc(READ_BUF_BYTES)
    this.readBufLen = READ_BUF_BYTES
  }

  static create(mod: OpentuiExports, opts: { widthMethod?: 'wcwidth' | 'unicode' } = {}): OpentuiEditBuffer {
    const ptr = mod.createEditBuffer(opts.widthMethod === 'unicode' ? 1 : 0)
    if (ptr === 0) throw new Error('opentui: createEditBuffer returned null')
    return new OpentuiEditBuffer(mod, ptr)
  }

  destroy() {
    this.mod.opentuiFree(this.readCursorPtr, 8)
    this.mod.opentuiFree(this.readBufPtr, this.readBufLen)
    this.mod.destroyEditBuffer(this.ptr)
  }

  insertText(text: string) {
    const bytes = encoder.encode(text)
    const ptr = this.mod.opentuiAlloc(bytes.length)
    new Uint8Array(this.mod.memory.buffer, ptr, bytes.length).set(bytes)
    this.mod.editBufferInsertText(this.ptr, ptr, bytes.length)
    this.mod.opentuiFree(ptr, bytes.length)
  }

  backspace() { this.mod.editBufferDeleteCharBackward(this.ptr) }
  deleteForward() { this.mod.editBufferDeleteChar(this.ptr) }
  newLine() { this.mod.editBufferNewLine(this.ptr) }
  moveLeft() { this.mod.editBufferMoveCursorLeft(this.ptr) }
  moveRight() { this.mod.editBufferMoveCursorRight(this.ptr) }
  moveUp() { this.mod.editBufferMoveCursorUp(this.ptr) }
  moveDown() { this.mod.editBufferMoveCursorDown(this.ptr) }

  getCursor(): Cursor {
    this.mod.editBufferGetCursor(this.ptr, this.readCursorPtr, this.readCursorPtr + 4)
    const view = new Uint32Array(this.mod.memory.buffer, this.readCursorPtr, 2)
    return { row: view[0]!, col: view[1]! }
  }

  getLineCount(): number {
    return this.mod.editBufferGetLineCount(this.ptr)
  }

  getText(): string {
    const written = this.mod.editBufferGetText(this.ptr, this.readBufPtr, this.readBufLen)
    if (written >= this.readBufLen) {
      // Need bigger buffer — grow and retry once.
      this.mod.opentuiFree(this.readBufPtr, this.readBufLen)
      this.readBufLen = written + (1 << 16)
      this.readBufPtr = this.mod.opentuiAlloc(this.readBufLen)
      const w2 = this.mod.editBufferGetText(this.ptr, this.readBufPtr, this.readBufLen)
      return decoder.decode(new Uint8Array(this.mod.memory.buffer, this.readBufPtr, w2))
    }
    return decoder.decode(new Uint8Array(this.mod.memory.buffer, this.readBufPtr, written))
  }
}
