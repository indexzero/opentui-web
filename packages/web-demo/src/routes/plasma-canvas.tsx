import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { CanvasPainter, OpentuiBuffer, hsv, loadOpentui } from 'opentui-browser'
import type { RGBA } from 'opentui-browser'
import { DemoFrame } from '../demo-lib/DemoLayout'

export const Route = createFileRoute('/plasma-canvas')({ component: PlasmaCanvas })

const UPPER_HALF_BLOCK = 0x2580

function plasmaAt(px: number, py: number, t: number, cols: number, rows: number): [number, number, number] {
  const dx = px - cols / 2
  const dy = py - rows
  const r = Math.sqrt(dx * dx + dy * dy)
  const v =
    Math.sin(px * 0.09 + t * 1.3) +
    Math.sin(py * 0.13 + t * 1.1) +
    Math.sin((px + py) * 0.06 + t * 0.7) +
    Math.sin(r * 0.18 + t * 1.7)
  return hsv(v * 60 + t * 40, 0.85, 0.95)
}

function PlasmaCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [cellInfo, setCellInfo] = useState<string>('')

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let painter: CanvasPainter | undefined
    let canvas: HTMLCanvasElement | undefined
    let rafId = 0
    let resizeObserver: ResizeObserver | undefined
    let resizeTimeout = 0
    let disposed = false

    function syncSize() {
      if (!painter || !buf || !hostRef.current) return
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      if (cols !== buf.width || rows !== buf.height) {
        buf.resize(cols, rows)
        buf.clear([0, 0, 0, 1])
      }
      setCellInfo(`${cols}x${rows}`)
    }

    loadOpentui()
      .then((opentui) => {
        if (disposed || !hostRef.current) return

        canvas = document.createElement('canvas')
        canvas.style.display = 'block'
        canvas.style.imageRendering = 'pixelated'
        hostRef.current.appendChild(canvas)

        painter = new CanvasPainter(canvas, { fontSize: 13 })
        const rect = hostRef.current.getBoundingClientRect()
        const { cols, rows } = painter.fit(rect.width, rect.height)
        painter.resize(cols, rows)
        buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'plasma-canvas', widthMethod: 'unicode' })
        buf.clear([0, 0, 0, 1])
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
          if (disposed || !buf || !painter) return
          const now = performance.now()
          const t = (now - startedAt) / 1000

          const cols = buf.width
          const rows = buf.height
          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const top = plasmaAt(x, y * 2, t, cols, rows)
              const bot = plasmaAt(x, y * 2 + 1, t, cols, rows)
              const fg: RGBA = [top[0], top[1], top[2], 1]
              const bg: RGBA = [bot[0], bot[1], bot[2], 1]
              buf.setCell(x, y, UPPER_HALF_BLOCK, fg, bg, 0)
            }
          }
          painter.paint(buf)

          framesThisSecond++
          if (now - lastSecond >= 1000) {
            setFps(framesThisSecond)
            framesThisSecond = 0
            lastSecond = now
          }
          rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
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
      title="plasma-canvas"
      subtitle={`direct 2d canvas paint · no ghostty · ${cellInfo}`}
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
