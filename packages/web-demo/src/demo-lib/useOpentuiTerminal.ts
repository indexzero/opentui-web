import { useEffect, useRef, useState } from 'react'
import { Terminal, init as initGhostty } from 'ghostty-web'
import { OpentuiBuffer, encodeBufferAsAnsi, loadOpentui } from 'opentui-browser'
import type { OpentuiExports } from 'opentui-browser'

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

export type DrawFn = (ctx: {
  buf: OpentuiBuffer
  opentui: OpentuiExports
  t: number
  frame: number
}) => void

interface Options {
  cols: number
  rows: number
  hideCursor?: boolean
  background?: string
  // Stable identity is required — the loop captures this once on mount.
  // Use a ref-based pattern if you need closures over fast-changing state.
  draw: DrawFn
}

// Mounts a ghostty-web Terminal, loads the opentui WASM, creates an OpentuiBuffer,
// and drives a requestAnimationFrame loop calling `draw` each frame. Returns the
// container ref and live status/fps so the calling component can render chrome.
export function useOpentuiTerminal(opts: Options) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const drawRef = useRef<DrawFn>(opts.draw)
  drawRef.current = opts.draw

  const { cols, rows, hideCursor, background } = opts

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
          cols,
          rows: rows + 2,
          theme: {
            background: background ?? '#0b0b14',
            foreground: '#c0caf5',
            cursor: '#7aa2f7',
          },
        })
        term.open(hostRef.current)
        if (hideCursor) term.write('\x1b[?25l')

        buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'demo', widthMethod: 'unicode' })
        buf.clear([0, 0, 0, 1])
        setError(null)
        setStatus('ready')

        const startedAt = performance.now()
        let lastSecond = startedAt
        let framesThisSecond = 0
        let frame = 0

        const tick = () => {
          if (disposed || !term || !buf) return
          const now = performance.now()
          const t = (now - startedAt) / 1000
          drawRef.current({ buf, opentui, t, frame })
          term.write(encodeBufferAsAnsi(buf, { clearScreen: true }))
          frame++
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
      if (term && hideCursor) {
        try {
          term.write('\x1b[?25h')
        } catch {}
      }
      buf?.destroy()
      term?.dispose()
    }
  }, [cols, rows, hideCursor, background])

  return { hostRef, status, error, fps }
}
