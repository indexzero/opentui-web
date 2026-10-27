import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

import { OpentuiBuffer, type RGBA } from './buffer'
import type { OpentuiExports } from './wasm'

let compiled: WebAssembly.Module
beforeAll(async () => {
  compiled = await WebAssembly.compile(new Uint8Array(readFileSync(new URL('./opentui.wasm', import.meta.url))))
})

async function module(): Promise<OpentuiExports> {
  return (await WebAssembly.instantiate(compiled, {})).exports as unknown as OpentuiExports
}

function copy(buf: OpentuiBuffer) {
  const { width, height, chars, fg, bg, attrs } = buf.snapshot()
  return { width, height, chars: chars.slice(), fg: fg.slice(), bg: bg.slice(), attrs: attrs.slice() }
}

const foreground: RGBA = [0.13, 0.37, 0.73, 0.65]
const background: RGBA = [0.91, 0.61, 0.31, 0.45]

function paint(buf: OpentuiBuffer, text = 'hello   ') {
  buf.clear(background)
  buf.setCell(0, 0, 0x41, foreground, background, 0x12345681)
  buf.drawText(text, 0, 1, foreground, 3)
}

describe('OpentuiBuffer color scratch views', () => {
  it.each([false, true])('preserves all channels across memory growth (respectAlpha=%s)', async respectAlpha => {
    const mod = await module()
    const buf = OpentuiBuffer.create(mod, 8, 3, { respectAlpha })
    try {
      paint(buf)
      const expected = copy(buf)
      for (const pages of [0, 1, 0]) {
        const previous = mod.memory.buffer
        mod.memory.grow(pages)
        expect(mod.memory.buffer).not.toBe(previous)
        expect(previous.byteLength).toBe(0)
        paint(buf)
        expect(copy(buf)).toEqual(expected)
      }
    } finally {
      buf.destroy()
    }
  })

  it('copies new values from reused mutable color tuples', async () => {
    const mod = await module()
    const buf = OpentuiBuffer.create(mod, 2, 1)
    const fg: [number, number, number, number] = [1, 0, 0, 1]
    const bg: [number, number, number, number] = [0, 0, 1, 1]
    try {
      buf.setCell(0, 0, 0x41, fg, bg)
      fg.splice(0, 4, ...foreground)
      bg.splice(0, 4, ...background)
      buf.setCell(1, 0, 0x42, fg, bg, 0x12345681)
      const cells = copy(buf)
      expect([...cells.fg.slice(0, 4)]).toEqual([1, 0, 0, 1])
      expect(cells.fg.slice(4)).toEqual(new Float32Array(foreground))
      expect(cells.bg.slice(4)).toEqual(new Float32Array(background))
      expect(cells.attrs[1]).toBe(0x12345681)
    } finally {
      buf.destroy()
    }
  })

  it('creates views after both scratch allocations and refreshes after text allocation', async () => {
    const wasm = await module()
    // Deterministically expose growth at every JS allocation boundary, while
    // using the real allocator and buffer operations for all data assertions.
    const mod: OpentuiExports = {
      ...wasm,
      opentuiAlloc(len) {
        const ptr = wasm.opentuiAlloc(len)
        wasm.memory.grow(0)
        return ptr
      },
    }
    const buf = OpentuiBuffer.create(mod, 8, 3)
    try {
      paint(buf)
      const expected = copy(buf)
      paint(buf, 'hello' + ' '.repeat(200))
      expect(copy(buf)).toEqual(expected)
      buf.clear(foreground)
      expect(copy(buf).bg.slice(0, 4)).toEqual(new Float32Array(foreground))
    } finally {
      buf.destroy()
    }
  })

  it('survives growth caused by another buffer and resizing its own grid', async () => {
    const mod = await module()
    const buf = OpentuiBuffer.create(mod, 8, 3)
    let other: OpentuiBuffer | undefined
    try {
      paint(buf)
      const expected = copy(buf)
      const previous = mod.memory.buffer
      other = OpentuiBuffer.create(mod, 1024, 1024)
      expect(mod.memory.buffer).not.toBe(previous)
      paint(buf)
      expect(copy(buf)).toEqual(expected)
      buf.resize(1024, 1024)
      buf.resize(8, 3)
      paint(buf)
      expect(copy(buf)).toEqual(expected)
    } finally {
      other?.destroy()
      buf.destroy()
    }
  })
})
