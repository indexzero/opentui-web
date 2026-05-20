import { OpentuiEditBuffer, drawBorder, drawString, fillRect } from 'opentui-browser'
import type { OpentuiBuffer, OpentuiExports, RGBA } from 'opentui-browser'

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

export function applyKey(data: string, eb: OpentuiEditBuffer) {
  let i = 0
  while (i < data.length) {
    const ch = data[i]!
    const code = ch.charCodeAt(0)
    if (ch === '\x1b' && data[i + 1] === '[') {
      const action = data[i + 2]
      if (action === 'A') eb.moveUp()
      else if (action === 'B') eb.moveDown()
      else if (action === 'C') eb.moveRight()
      else if (action === 'D') eb.moveLeft()
      else if (action === '3' && data[i + 3] === '~') eb.deleteForward()
      let j = i + 2
      while (j < data.length && (data.charCodeAt(j) < 0x40 || data.charCodeAt(j) > 0x7e)) j++
      i = j + 1
      continue
    }
    if (code === 0x7f || code === 0x08) { eb.backspace(); i++; continue }
    if (ch === '\r' || ch === '\n') { eb.newLine(); i++; continue }
    if (code < 0x20) { i++; continue }
    let j = i
    while (j < data.length && data.charCodeAt(j) >= 0x20 && data.charCodeAt(j) !== 0x7f && data[j] !== '\x1b') j++
    eb.insertText(data.slice(i, j))
    i = j
  }
}

// Returns a draw+input pair that closes over an EditBuffer. Same instance is
// reused across frames and the input handler mutates that buffer in place.
export function createEditorKernel() {
  let eb: OpentuiEditBuffer | null = null
  let seeded = false
  let blinkStart = performance.now()

  const draw = (buf: OpentuiBuffer, _t: number, _frame: number, opentui: OpentuiExports) => {
    if (!eb) {
      eb = OpentuiEditBuffer.create(opentui, { widthMethod: 'unicode' })
    }
    if (!seeded) {
      eb.insertText(SEED_TEXT)
      seeded = true
    }

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

    const cursorVisible = ((performance.now() - blinkStart) % 1060) < 530
    const cursorRow = cursor.row - scrollY
    if (cursorVisible && cursorRow >= 0 && cursorRow < visibleH && cursor.col <= visibleW) {
      const lineIdx = cursor.row
      const lineCh = lineIdx < lines.length ? lines[lineIdx]! : ''
      const charUnder = cursor.col < lineCh.length ? lineCh.charCodeAt(cursor.col) : 0x20
      buf.setCell(startX + cursor.col, startY + cursorRow, charUnder, BG, ACCENT, 0)
    }

    const cursorText = `row ${cursor.row + 1} · col ${cursor.col + 1}`
    const docText = `${lines.length} line${lines.length === 1 ? '' : 's'} · ${text.length} chars`
    drawString(buf, ' EditBuffer', 2, rows - 1, GREEN, BG, 1)
    drawString(buf, docText, 16, rows - 1, TEXT_DIM, BG, 0)
    drawString(buf, cursorText, cols - cursorText.length - 2, rows - 1, ACCENT, BG, 0)
  }

  const handleInput = (data: string) => {
    if (!eb) return
    applyKey(data, eb)
    blinkStart = performance.now()
  }

  return { draw, handleInput }
}
