import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { OpentuiBuffer, encodeBufferAsAnsi, hsv, loadOpentui } from 'opentui-browser'
import type { RGBA } from 'opentui-browser'
import { DemoFrame } from '../demo-lib/DemoLayout'

export const Route = createFileRoute('/plasma-xterm')({ component: PlasmaXterm })

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

function PlasmaXterm() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [renderer, setRenderer] = useState<'webgl' | 'canvas'>('webgl')

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let term: Terminal | undefined
    let fit: FitAddon | undefined
    let webgl: WebglAddon | undefined
    let resizeObserver: ResizeObserver | undefined
    let resizeTimeout = 0
    let rafId = 0
    let disposed = false

    function syncSize() {
      if (!term || !fit || !buf) return
      try { fit.fit() } catch { return }
      if (term.cols !== buf.width || term.rows !== buf.height) {
        buf.resize(term.cols, term.rows)
        buf.clear([0, 0, 0, 1])
      }
    }

    loadOpentui()
      .then((opentui) => {
        if (disposed || !hostRef.current) return

        term = new Terminal({
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          theme: { background: '#0b0b14', foreground: '#c0caf5' },
          cursorBlink: false,
          disableStdin: true,
          allowProposedApi: true,
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        term.open(hostRef.current)
        // Try WebGL renderer; fall back to default (canvas) if unsupported.
        try {
          webgl = new WebglAddon()
          term.loadAddon(webgl)
          webgl.onContextLoss(() => { webgl?.dispose() })
          setRenderer('webgl')
        } catch {
          setRenderer('canvas')
        }
        term.write('\x1b[?25l')
        try { fit.fit() } catch {}

        buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), {
          id: 'plasma-xterm',
          widthMethod: 'unicode',
        })
        buf.clear([0, 0, 0, 1])

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
        let firstFrame = true

        const tick = () => {
          if (disposed || !buf || !term) return
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
          term.write(encodeBufferAsAnsi(buf, { clearScreen: firstFrame }))
          firstFrame = false
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
      webgl?.dispose()
      buf?.destroy()
      term?.dispose()
    }
  }, [])

  return (
    <DemoFrame
      title="plasma-xterm"
      subtitle={`xterm.js v6 (${renderer} renderer) · opentui WASM emits ANSI`}
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
