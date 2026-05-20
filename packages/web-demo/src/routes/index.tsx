import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Terminal, init as initGhostty } from 'ghostty-web'
import { OpentuiBuffer, encodeBufferAsAnsi, loadOpentui } from 'opentui-browser'
import type { RGBA } from 'opentui-browser'

export const Route = createFileRoute('/')({ component: Home })

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

const COLS = 100
const ROWS = 30
const UPPER_HALF_BLOCK = 0x2580 // ▀  fg = top pixel, bg = bottom pixel

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) { r = c; g = x }
  else if (hp < 2) { r = x; g = c }
  else if (hp < 3) { g = c; b = x }
  else if (hp < 4) { g = x; b = c }
  else if (hp < 5) { r = x; b = c }
  else { r = c; b = x }
  const m = v - c
  return [r + m, g + m, b + m]
}

function plasmaAt(px: number, py: number, t: number): [number, number, number] {
  const cx = COLS / 2
  const cy = ROWS
  const dx = px - cx
  const dy = py - cy
  const r = Math.sqrt(dx * dx + dy * dy)
  const v =
    Math.sin(px * 0.09 + t * 1.3) +
    Math.sin(py * 0.13 + t * 1.1) +
    Math.sin((px + py) * 0.06 + t * 0.7) +
    Math.sin(r * 0.18 + t * 1.7)
  const h = (v * 60 + t * 40) % 360
  return hsvToRgb(h, 0.85, 0.95)
}

function Home() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)

  useEffect(() => {
    let term: Terminal | undefined
    let buf: OpentuiBuffer | undefined
    let rafId = 0
    let disposed = false

    Promise.all([ensureGhostty(), loadOpentui()])
      .then(([, opentui]) => {
        if (disposed || !hostRef.current) return

        term = new Terminal({
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          cols: COLS,
          rows: ROWS + 4,
          theme: {
            background: '#0b0b14',
            foreground: '#c0caf5',
            cursor: '#7aa2f7',
          },
        })
        term.open(hostRef.current)

        buf = OpentuiBuffer.create(opentui, COLS, ROWS, { id: 'plasma', widthMethod: 'unicode' })
        buf.clear([0, 0, 0, 1])
        setError(null)
        setStatus('ready')

        // Hide cursor while the animation drives the viewport.
        term.write('\x1b[?25l')

        const startedAt = performance.now()
        let lastSecond = startedAt
        let framesThisSecond = 0
        let lastFps = 0

        const tick = () => {
          if (disposed || !term || !buf) return
          const now = performance.now()
          const t = (now - startedAt) / 1000

          // Two vertical pixels per cell via upper-half-block.
          for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLS; x++) {
              const top = plasmaAt(x, y * 2, t)
              const bot = plasmaAt(x, y * 2 + 1, t)
              const fg: RGBA = [top[0], top[1], top[2], 1]
              const bg: RGBA = [bot[0], bot[1], bot[2], 1]
              buf.setCell(x, y, UPPER_HALF_BLOCK, fg, bg, 0)
            }
          }

          // Overlay title and live stats on top of the plasma using opentui's drawText.
          const label = `  opentui WASM -> ghostty-web :: plasma  ${lastFps.toString().padStart(2, ' ')} fps  `
          for (let i = 0; i < label.length; i++) {
            buf.setCell(2 + i, 1, label.charCodeAt(i), [1, 1, 1, 1], [0.04, 0.04, 0.08, 1], 1)
          }
          const sub = `  ${COLS}x${ROWS} cells / ${COLS * ROWS * 2} pixels / 60fps target  `
          for (let i = 0; i < sub.length; i++) {
            buf.setCell(2 + i, 2, sub.charCodeAt(i), [0.7, 0.74, 0.86, 1], [0.04, 0.04, 0.08, 1], 0)
          }

          term.write(encodeBufferAsAnsi(buf, { clearScreen: true }))

          framesThisSecond++
          if (now - lastSecond >= 1000) {
            lastFps = framesThisSecond
            setFps(lastFps)
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
      if (term) {
        try {
          term.write('\x1b[?25h')
        } catch {}
      }
      buf?.destroy()
      term?.dispose()
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-[#0b0b14] text-[#c0caf5]">
      <header className="border-b border-white/5 px-4 py-3">
        <h1 className="font-mono text-sm">open-tui-ghostty-web · plasma demo</h1>
        <p className="font-mono text-xs text-white/40">
          opentui WASM → ghostty-web ·{' '}
          <span className={status === 'ready' ? 'text-[#9ece6a]' : 'text-white/50'}>{status}</span>
          {status === 'ready' ? <span className="ml-3 text-[#7aa2f7]">{fps} fps</span> : null}
          {error ? <span className="ml-2 text-[#f7768e]">{error}</span> : null}
        </p>
      </header>
      <main className="flex-1 overflow-hidden p-3">
        <div
          ref={hostRef}
          className="h-full w-full overflow-hidden rounded-md border border-white/5"
        />
      </main>
    </div>
  )
}
