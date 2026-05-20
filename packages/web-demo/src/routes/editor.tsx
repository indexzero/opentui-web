import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useOpentuiTerminal } from '../demo-lib/useOpentuiTerminal'
import { DemoFrame } from '../demo-lib/DemoLayout'
import { drawBorder, drawString, fillRect } from 'opentui-browser'
import { OpentuiEditBuffer } from 'opentui-browser'
import type { RGBA } from 'opentui-browser'

export const Route = createFileRoute('/editor')({ component: Editor })

const BG: RGBA = [0.04, 0.04, 0.08, 1]
const PANEL_BG: RGBA = [0.06, 0.07, 0.11, 1]
const BORDER: RGBA = [0.24, 0.3, 0.5, 1]
const TEXT: RGBA = [0.76, 0.79, 0.96, 1]
const TEXT_DIM: RGBA = [0.46, 0.49, 0.62, 1]
const ACCENT: RGBA = [0.48, 0.61, 0.97, 1]
const GREEN: RGBA = [0.62, 0.81, 0.42, 1]
const LINE_NO: RGBA = [0.35, 0.39, 0.55, 1]

const SEED_TEXT = [
  '// type to edit. arrows / backspace / enter work.',
  '// state lives in opentui\'s WASM EditBuffer.',
  '',
  'fn fibonacci(n: u32) u32 {',
  '    if (n < 2) return n;',
  '    return fibonacci(n - 1) + fibonacci(n - 2);',
  '}',
].join('\n')

// Tiny VT input parser: turns the bytes ghostty-web hands us into actions on
// the EditBuffer. Handles printable, backspace, enter, and the arrow CSI
// sequences ghostty emits. Anything we don't recognize is silently dropped.
function applyKey(data: string, eb: OpentuiEditBuffer) {
  let i = 0
  while (i < data.length) {
    const ch = data[i]!
    const code = ch.charCodeAt(0)

    if (ch === '\x1b' && data[i + 1] === '[') {
      // CSI: ESC [ <char>. Arrows are A/B/C/D.
      const action = data[i + 2]
      if (action === 'A') eb.moveUp()
      else if (action === 'B') eb.moveDown()
      else if (action === 'C') eb.moveRight()
      else if (action === 'D') eb.moveLeft()
      else if (action === '3' && data[i + 3] === '~') eb.deleteForward()
      // advance past the whole sequence — find the final byte (0x40..0x7E)
      let j = i + 2
      while (j < data.length && (data.charCodeAt(j) < 0x40 || data.charCodeAt(j) > 0x7e)) j++
      i = j + 1
      continue
    }
    if (code === 0x7f || code === 0x08) {
      eb.backspace()
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      eb.newLine()
      i++
      continue
    }
    if (code < 0x20) {
      // Other control bytes (Ctrl-letter, etc.) — skip for now.
      i++
      continue
    }
    // Take the next graphemes up to the next control byte and insert as one batch.
    let j = i
    while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) !== 0x7f && data[j] !== '\x1b') j++
    eb.insertText(data.slice(i, j))
    i = j
  }
}

function Editor() {
  const ebRef = useRef<OpentuiEditBuffer | null>(null)
  const seededRef = useRef(false)
  const blinkStart = useRef(performance.now())
  const [stats, setStats] = useState({ chars: 0, lines: 0 })

  // Reset every-frame state when the buffer is destroyed (route unmount).
  useEffect(() => () => {
    ebRef.current?.destroy()
    ebRef.current = null
    seededRef.current = false
  }, [])

  const { hostRef, status, error, fps } = useOpentuiTerminal({
    hideCursor: true,
    onData: (data, { opentui }) => {
      if (!ebRef.current) {
        ebRef.current = OpentuiEditBuffer.create(opentui, { widthMethod: 'unicode' })
      }
      applyKey(data, ebRef.current)
      blinkStart.current = performance.now() // freshen the cursor on activity
    },
    draw: ({ buf, opentui, t }) => {
      if (!ebRef.current) {
        ebRef.current = OpentuiEditBuffer.create(opentui, { widthMethod: 'unicode' })
      }
      if (!seededRef.current) {
        ebRef.current.insertText(SEED_TEXT)
        seededRef.current = true
      }

      const eb = ebRef.current
      const cols = buf.width
      const rows = buf.height

      fillRect(buf, 0, 0, cols, rows, BG)
      drawBorder(buf, 0, 0, cols, rows - 1, BORDER, 'opentui editbuffer · wasm-backed')

      const text = eb.getText()
      const cursor = eb.getCursor()
      const lines = text.split('\n')

      const lineNumW = String(Math.max(1, lines.length)).length + 1
      const startX = 2 + lineNumW + 1
      const startY = 2
      const visibleH = rows - 4
      const visibleW = cols - startX - 2

      // Simple top-aligned viewport — scroll if cursor goes off-screen.
      const scrollY = Math.max(0, cursor.row - visibleH + 1)

      for (let i = 0; i < visibleH; i++) {
        const lineIdx = scrollY + i
        if (lineIdx >= lines.length) break
        const line = lines[lineIdx]!
        const ln = String(lineIdx + 1).padStart(lineNumW, ' ')
        drawString(buf, ln, 2, startY + i, LINE_NO, PANEL_BG, 0)
        const truncated = line.length > visibleW ? line.slice(0, visibleW) : line
        drawString(buf, truncated, startX, startY + i, TEXT, BG, 0)
      }

      // Blinking cursor — render once per ~530ms half-period.
      const cursorVisible = ((performance.now() - blinkStart.current) % 1060) < 530
      const cursorRow = cursor.row - scrollY
      if (cursorVisible && cursorRow >= 0 && cursorRow < visibleH && cursor.col <= visibleW) {
        const lineIdx = cursor.row
        const lineCh = lineIdx < lines.length ? lines[lineIdx]! : ''
        const charUnderCursor = cursor.col < lineCh.length ? lineCh.charCodeAt(cursor.col) : 0x20
        buf.setCell(startX + cursor.col, startY + cursorRow, charUnderCursor, BG, ACCENT, 0)
      }

      // Status line at bottom.
      const cursorText = `row ${cursor.row + 1} · col ${cursor.col + 1}`
      const docText = `${lines.length} line${lines.length === 1 ? '' : 's'} · ${text.length} chars`
      drawString(buf, ' EditBuffer', 2, rows - 1, GREEN, BG, 1)
      drawString(buf, docText, 16, rows - 1, TEXT_DIM, BG, 0)
      drawString(buf, cursorText, cols - cursorText.length - 2, rows - 1, ACCENT, BG, 0)
      void t
    },
  })

  // Keep header subtitle in sync — re-read stats on a slow interval rather
  // than every frame to avoid React spam.
  useEffect(() => {
    if (status !== 'ready') return
    const id = window.setInterval(() => {
      const eb = ebRef.current
      if (!eb) return
      const text = eb.getText()
      setStats({ chars: text.length, lines: text.split('\n').length })
    }, 200)
    return () => window.clearInterval(id)
  }, [status])

  return (
    <DemoFrame
      title="editor"
      subtitle={`type into me · WASM EditBuffer · ${stats.lines}L / ${stats.chars}c`}
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
