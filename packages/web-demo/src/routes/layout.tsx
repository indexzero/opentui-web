import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useOpentuiTerminal } from '../demo-lib/useOpentuiTerminal'
import { DemoFrame } from '../demo-lib/DemoLayout'
import { OpentuiEditBuffer, drawBar, drawString, fillRect, hsv } from 'opentui-browser'
import type { OpentuiBuffer, RGBA } from 'opentui-browser'
import { box, custom, layoutAndDraw, text } from 'opentui-browser/layout'
import type { Rect, SceneNode } from 'opentui-browser/layout'

export const Route = createFileRoute('/layout')({ component: LayoutDemo })

const BG: RGBA = [0.04, 0.04, 0.08, 1]
const PANEL_BG: RGBA = [0.06, 0.07, 0.11, 1]
const TRACK: RGBA = [0.13, 0.14, 0.21, 1]
const ACCENT: RGBA = [0.48, 0.61, 0.97, 1]
const ACCENT_DIM: RGBA = [0.24, 0.3, 0.5, 1]
const TEXT: RGBA = [0.76, 0.79, 0.96, 1]
const TEXT_DIM: RGBA = [0.46, 0.49, 0.62, 1]
const GREEN: RGBA = [0.62, 0.81, 0.42, 1]
const LINE_NO: RGBA = [0.35, 0.39, 0.55, 1]

const SIDEBAR_ITEMS = ['Overview', 'Metrics', 'Logs', 'Editor', 'Settings']

const SEED_TEXT = [
  '// editor lives inside the layout demo.',
  '// type here to test responsiveness.',
  '',
  'fn lerp(a, b, t) {',
  '    return a + (b - a) * t;',
  '}',
].join('\n')

// Tiny VT input parser (same shape as the standalone /editor uses).
function applyKey(data: string, eb: OpentuiEditBuffer) {
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

function LayoutDemo() {
  const [active, setActive] = useState(0)
  const ringRef = useRef<number[]>([])
  const ebRef = useRef<OpentuiEditBuffer | null>(null)
  const seededRef = useRef(false)
  const blinkStartRef = useRef(performance.now())

  useEffect(() => {
    const id = window.setInterval(() => setActive((i) => (i + 1) % SIDEBAR_ITEMS.length), 2200)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => () => {
    ebRef.current?.destroy()
    ebRef.current = null
    seededRef.current = false
  }, [])

  const drawMetrics: (t: number) => Parameters<typeof custom>[0]['draw'] = (t) => (buf, rect) => {
    const innerX = rect.x + 2
    const innerW = rect.width - 4
    const labels = ['cpu', 'mem', 'net', 'i/o']
    for (let i = 0; i < labels.length; i++) {
      const y = rect.y + 1 + i * 2
      if (y >= rect.y + rect.height - 1) break
      const v = 0.5 + 0.4 * Math.sin(t * (1 + i * 0.3) + i)
      drawString(buf, labels[i]!, innerX, y, TEXT, PANEL_BG, 1)
      drawBar(buf, innerX + 5, y, Math.max(0, innerW - 12), Math.max(0, Math.min(1, v)), [0.48 + i * 0.1, 0.7 - i * 0.1, 0.95 - i * 0.05, 1], TRACK)
      const pct = `${Math.round(v * 100).toString().padStart(3, ' ')}%`
      drawString(buf, pct, innerX + innerW - 4, y, ACCENT, PANEL_BG, 1)
    }
  }

  const drawPlasma: (t: number) => Parameters<typeof custom>[0]['draw'] = (t) => (buf, rect) => {
    for (let yy = 0; yy < rect.height; yy++) {
      for (let xx = 0; xx < rect.width; xx++) {
        const a =
          Math.sin(xx * 0.16 + t * 1.4) +
          Math.sin((xx + yy * 2) * 0.1 + t * 1.7) +
          Math.sin(Math.hypot(xx - rect.width / 2, yy * 2 - rect.height) * 0.2 + t * 1.5)
        const b =
          Math.sin(xx * 0.16 + t * 1.4) +
          Math.sin((xx + (yy * 2 + 1)) * 0.1 + t * 1.7) +
          Math.sin(Math.hypot(xx - rect.width / 2, yy * 2 + 1 - rect.height) * 0.2 + t * 1.5)
        const top = hsv(a * 50 + t * 30, 0.7, 0.9)
        const bot = hsv(b * 50 + t * 30, 0.7, 0.9)
        buf.setCell(rect.x + xx, rect.y + yy, 0x2580,
          [top[0], top[1], top[2], 1], [bot[0], bot[1], bot[2], 1], 0)
      }
    }
  }

  const drawRing: (t: number) => Parameters<typeof custom>[0]['draw'] = (t) => (buf, rect) => {
    const ring = ringRef.current
    const perimeter = 2 * (rect.width + rect.height) - 4
    if (ring.length !== perimeter) {
      ring.length = perimeter
      for (let i = 0; i < perimeter; i++) ring[i] = 0
    }
    const head = Math.floor(t * 25) % perimeter
    for (let i = 0; i < perimeter; i++) {
      const age = (perimeter + head - i) % perimeter
      ring[i] = Math.max(0, 1 - age / 20)
    }
    let i = 0
    const setEdge = (px: number, py: number) => {
      const v = ring[i++] ?? 0
      const col: RGBA = [v * 0.95, v * 0.5, v + 0.05, 1]
      buf.setCell(px, py, 0x2588, col, PANEL_BG, 0)
    }
    for (let x = 0; x < rect.width; x++) setEdge(rect.x + x, rect.y)
    for (let y = 1; y < rect.height; y++) setEdge(rect.x + rect.width - 1, rect.y + y)
    for (let x = rect.width - 2; x >= 0; x--) setEdge(rect.x + x, rect.y + rect.height - 1)
    for (let y = rect.height - 2; y >= 1; y--) setEdge(rect.x, rect.y + y)
    drawString(buf, ' activity', rect.x + 2, rect.y + Math.floor(rect.height / 2) - 1, TEXT_DIM, PANEL_BG, 1)
    drawString(buf, `t = ${t.toFixed(1)}s`, rect.x + 2, rect.y + Math.floor(rect.height / 2) + 1, ACCENT, PANEL_BG, 1)
  }

  const drawEditor: () => Parameters<typeof custom>[0]['draw'] = () => (buf: OpentuiBuffer, rect: Rect) => {
    const eb = ebRef.current
    if (!eb) return
    fillRect(buf, rect.x, rect.y, rect.width, rect.height, PANEL_BG)
    const text = eb.getText()
    const cursor = eb.getCursor()
    const lines = text.split('\n')
    const lineNumW = String(Math.max(1, lines.length)).length + 1
    const startX = rect.x + 1 + lineNumW + 1
    const startY = rect.y + 1
    const visibleH = rect.height - 2
    const visibleW = rect.width - (lineNumW + 4)
    const scrollY = Math.max(0, cursor.row - visibleH + 1)

    for (let i = 0; i < visibleH; i++) {
      const lineIdx = scrollY + i
      if (lineIdx >= lines.length) break
      const line = lines[lineIdx]!
      const ln = String(lineIdx + 1).padStart(lineNumW, ' ')
      drawString(buf, ln, rect.x + 1, startY + i, LINE_NO, PANEL_BG, 0)
      const truncated = line.length > visibleW ? line.slice(0, visibleW) : line
      drawString(buf, truncated, startX, startY + i, TEXT, PANEL_BG, 0)
    }

    const cursorVisible = ((performance.now() - blinkStartRef.current) % 1060) < 530
    const cursorRow = cursor.row - scrollY
    if (cursorVisible && cursorRow >= 0 && cursorRow < visibleH && cursor.col <= visibleW) {
      const lineIdx = cursor.row
      const lineCh = lineIdx < lines.length ? lines[lineIdx]! : ''
      const charUnder = cursor.col < lineCh.length ? lineCh.charCodeAt(cursor.col) : 0x20
      buf.setCell(startX + cursor.col, startY + cursorRow, charUnder, PANEL_BG, ACCENT, 0)
    }
  }

  const scene: (t: number) => SceneNode = (t) =>
    box({
      direction: 'column',
      padding: 1,
      gap: 1,
      children: [
        box({
          height: 3,
          direction: 'row',
          align: 'center',
          padding: 1,
          bg: PANEL_BG,
          border: { color: ACCENT, title: 'yoga layout · driven by flex' },
          children: [
            text({ content: 'opentui', color: ACCENT, attrs: 1 }),
            box({ flex: 1 }),
            text({ content: `tab: ${SIDEBAR_ITEMS[active]!}`, color: TEXT, attrs: 1 }),
            box({ width: 2 }),
            text({ content: 'live', color: GREEN, attrs: 1 }),
          ],
        }),

        box({
          flex: 1,
          direction: 'row',
          gap: 1,
          children: [
            // sidebar
            box({
              width: 22,
              direction: 'column',
              padding: 1,
              bg: PANEL_BG,
              border: { color: ACCENT_DIM, title: 'sidebar' },
              children: SIDEBAR_ITEMS.map((label, idx) =>
                box({
                  height: 1,
                  direction: 'row',
                  children: [
                    text({
                      content: (idx === active ? '▸ ' : '  ') + label,
                      color: idx === active ? ACCENT : TEXT_DIM,
                      attrs: idx === active ? 1 : 0,
                      width: 18,
                    }),
                  ],
                }),
              ),
            }),

            box({
              flex: 1,
              direction: 'column',
              gap: 1,
              children: [
                // metrics + activity row
                box({
                  height: 11,
                  direction: 'row',
                  gap: 1,
                  children: [
                    box({
                      flex: 2,
                      bg: PANEL_BG,
                      border: { color: ACCENT_DIM, title: 'metrics' },
                      children: [custom({ flex: 1, draw: drawMetrics(t) })],
                    }),
                    box({
                      flex: 1,
                      bg: PANEL_BG,
                      border: { color: ACCENT_DIM, title: 'activity' },
                      children: [custom({ flex: 1, draw: drawRing(t) })],
                    }),
                  ],
                }),

                // editor + plasma row
                box({
                  flex: 1,
                  direction: 'row',
                  gap: 1,
                  children: [
                    box({
                      flex: 1,
                      bg: PANEL_BG,
                      border: { color: ACCENT_DIM, title: 'editor · type here' },
                      children: [custom({ flex: 1, draw: drawEditor() })],
                    }),
                    box({
                      flex: 1,
                      bg: PANEL_BG,
                      border: { color: ACCENT_DIM, title: 'plasma' },
                      children: [custom({ flex: 1, draw: drawPlasma(t) })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),

        box({
          height: 1,
          direction: 'row',
          children: [
            text({ content: ' yoga + opentui WASM ', color: GREEN, attrs: 1 }),
            box({ flex: 1 }),
            text({ content: 'click the canvas and type — keys go to the EditBuffer in the editor panel', color: TEXT_DIM }),
          ],
        }),
      ],
    })

  const { hostRef, status, error, fps, bytesPerFrame, encoderMode } = useOpentuiTerminal({
    hideCursor: true,
    encoderMode: 'diff',
    onData: (data, { opentui }) => {
      if (!ebRef.current) {
        ebRef.current = OpentuiEditBuffer.create(opentui, { widthMethod: 'unicode' })
        ebRef.current.insertText(SEED_TEXT)
        seededRef.current = true
      }
      applyKey(data, ebRef.current)
      blinkStartRef.current = performance.now()
    },
    draw: ({ buf, opentui, t }) => {
      // Lazy-create the editor on first draw if no input has touched it yet.
      if (!ebRef.current) {
        ebRef.current = OpentuiEditBuffer.create(opentui, { widthMethod: 'unicode' })
      }
      if (!seededRef.current) {
        ebRef.current.insertText(SEED_TEXT)
        seededRef.current = true
      }
      fillRect(buf, 0, 0, buf.width, buf.height, BG)
      layoutAndDraw(scene(t), buf)
    },
  })

  return (
    <DemoFrame
      title="layout"
      subtitle="yoga flex · sidebar / metrics / activity / editor / plasma · all composed"
      status={status}
      fps={fps}
      bytesPerFrame={bytesPerFrame}
      encoderMode={encoderMode}
      error={error}
      hostRef={hostRef}
    />
  )
}
