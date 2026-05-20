import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { CanvasPainter, OpentuiBuffer, loadOpentui } from 'opentui-browser'
import type { RGBA } from 'opentui-browser'
import { DemoFrame } from '../demo-lib/DemoLayout'

export const Route = createFileRoute('/fire')({ component: Fire })

const UPPER_HALF_BLOCK = 0x2580
const BLACK: RGBA = [0, 0, 0, 1]

// Fire palette: 256 entries from black through dark red, orange, yellow, white.
const PALETTE: [number, number, number][] = (() => {
  const p: [number, number, number][] = []
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let r = 0, g = 0, b = 0
    if (t < 0.25) {
      const k = t / 0.25
      r = k * 80
      g = 0
      b = 0
    } else if (t < 0.5) {
      const k = (t - 0.25) / 0.25
      r = 80 + k * 175
      g = k * 80
      b = 0
    } else if (t < 0.75) {
      const k = (t - 0.5) / 0.25
      r = 255
      g = 80 + k * 175
      b = k * 60
    } else {
      const k = (t - 0.75) / 0.25
      r = 255
      g = 255
      b = 60 + k * 195
    }
    p.push([r / 255, g / 255, b / 255])
  }
  return p
})()

function Fire() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [cellInfo, setCellInfo] = useState('')

  // Fire field is twice the buffer's rows (we render with half-blocks).
  const fieldRef = useRef<Uint8Array | null>(null)
  const fieldColsRef = useRef(0)
  const fieldRowsRef = useRef(0)

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let painter: CanvasPainter | undefined
    let canvas: HTMLCanvasElement | undefined
    let rafId = 0
    let resizeObserver: ResizeObserver | undefined
    let resizeTimeout = 0
    let disposed = false

    function ensureField(cols: number, rows: number) {
      const fieldCols = cols
      const fieldRows = rows * 2
      if (
        fieldRef.current &&
        fieldColsRef.current === fieldCols &&
        fieldRowsRef.current === fieldRows
      ) return
      fieldRef.current = new Uint8Array(fieldCols * fieldRows)
      fieldColsRef.current = fieldCols
      fieldRowsRef.current = fieldRows
    }

    function syncSize() {
      if (!painter || !buf || !hostRef.current) return
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      if (cols !== buf.width || rows !== buf.height) {
        buf.resize(cols, rows)
        buf.clear(BLACK)
      }
      ensureField(cols, rows)
      setCellInfo(`${cols}x${rows}`)
    }

    loadOpentui()
      .then((opentui) => {
        if (disposed || !hostRef.current) return
        canvas = document.createElement('canvas')
        canvas.style.display = 'block'
        hostRef.current.appendChild(canvas)
        painter = new CanvasPainter(canvas, { fontSize: 13 })
        const rect = hostRef.current.getBoundingClientRect()
        const { cols, rows } = painter.fit(rect.width, rect.height)
        painter.resize(cols, rows)
        buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'fire', widthMethod: 'unicode' })
        buf.clear(BLACK)
        ensureField(cols, rows)
        setCellInfo(`${cols}x${rows}`)

        resizeObserver = new ResizeObserver(() => {
          if (resizeTimeout) window.clearTimeout(resizeTimeout)
          resizeTimeout = window.setTimeout(() => {
            resizeTimeout = 0
            syncSize()
          }, 120)
        })
        resizeObserver.observe(hostRef.current)

        setError(null)
        setStatus('ready')

        const startedAt = performance.now()
        let lastSecond = startedAt
        let framesThisSecond = 0

        const tick = () => {
          if (disposed || !buf || !painter || !fieldRef.current) return
          const field = fieldRef.current
          const fieldCols = fieldColsRef.current
          const fieldRows = fieldRowsRef.current
          const cols = buf.width
          const rows = buf.height

          // Seed the bottom row with hot pixels — flicker by randomly clamping.
          for (let x = 0; x < fieldCols; x++) {
            field[(fieldRows - 1) * fieldCols + x] = Math.random() < 0.85 ? 255 : 0
          }
          // Propagate upward with cooling and lateral drift.
          for (let y = 0; y < fieldRows - 1; y++) {
            for (let x = 0; x < fieldCols; x++) {
              const below = (y + 1) * fieldCols
              const left = field[below + (x > 0 ? x - 1 : x)]!
              const center = field[below + x]!
              const right = field[below + (x < fieldCols - 1 ? x + 1 : x)]!
              const farBelow = y + 2 < fieldRows ? field[(y + 2) * fieldCols + x]! : center
              const avg = (left + center + right + farBelow) >> 2
              const decay = 1 + ((Math.random() * 3) | 0)
              const next = avg > decay ? avg - decay : 0
              const dx = (Math.random() * 3) | 0
              field[y * fieldCols + (x + dx >= fieldCols ? fieldCols - 1 : x + dx)] = next
            }
          }

          // Render two field-rows per buffer-row using upper-half-block.
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const top = field[(y * 2) * fieldCols + x]!
              const bot = field[(y * 2 + 1) * fieldCols + x]!
              const fg = PALETTE[top]!
              const bg = PALETTE[bot]!
              buf.setCell(
                x,
                y,
                UPPER_HALF_BLOCK,
                [fg[0], fg[1], fg[2], 1],
                [bg[0], bg[1], bg[2], 1],
                0,
              )
            }
          }
          painter.paint(buf)

          framesThisSecond++
          const now = performance.now()
          if (now - lastSecond >= 1000) {
            setFps(framesThisSecond)
            framesThisSecond = 0
            lastSecond = now
          }
          rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        void startedAt
      })
      .catch((err) => {
        setError(err?.message ?? String(err))
        setStatus('error')
      })

    return () => {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      resizeObserver?.disconnect()
      buf?.destroy()
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  return (
    <DemoFrame
      title="fire"
      subtitle={`palette-mapped cellular fire · direct canvas · ${cellInfo}`}
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
