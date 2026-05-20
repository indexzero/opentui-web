import { useEffect, useRef, useState } from 'react'
import { FitAddon, Terminal, init as initGhostty } from 'ghostty-web'
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
  term: Terminal
  t: number
  frame: number
}) => void

interface Options {
  hideCursor?: boolean
  background?: string
  fontSize?: number
  onData?: (data: string, ctx: { opentui: OpentuiExports }) => void
  draw: DrawFn
}

// Mounts ghostty-web, sizes itself to the container via FitAddon + ResizeObserver,
// loads opentui WASM, and drives an rAF loop. The opentui buffer is resized in-
// place on container changes (no destroy/create churn) and the observer is
// debounced so a drag-resize doesn't thrash the pipeline.
export function useOpentuiTerminal(opts: Options) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)

  const drawRef = useRef<DrawFn>(opts.draw)
  drawRef.current = opts.draw
  const onDataRef = useRef(opts.onData)
  onDataRef.current = opts.onData

  const { hideCursor, background, fontSize } = opts

  useEffect(() => {
    let term: Terminal | undefined
    let buf: OpentuiBuffer | undefined
    let fit: FitAddon | undefined
    let opentuiExports: OpentuiExports | undefined
    let rafId = 0
    let disposed = false
    let resizeObserver: ResizeObserver | undefined
    let resizeTimeout = 0

    function syncSize() {
      if (!term || !buf || !fit) return
      try { fit.fit() } catch { return }
      if (term.cols !== buf.width || term.rows !== buf.height) {
        buf.resize(term.cols, term.rows)
        buf.clear([0, 0, 0, 1])
      }
    }

    Promise.all([ensureGhostty(), loadOpentui()])
      .then(([, opentui]) => {
        opentuiExports = opentui
        if (disposed || !hostRef.current) return

        term = new Terminal({
          fontSize: fontSize ?? 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          theme: {
            background: background ?? '#0b0b14',
            foreground: '#c0caf5',
            cursor: '#7aa2f7',
          },
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        term.open(hostRef.current)
        if (hideCursor) term.write('\x1b[?25l')
        if (onDataRef.current) {
          term.onData((data) => onDataRef.current?.(data, { opentui }))
        }

        try { fit.fit() } catch {}
        buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), {
          id: 'demo',
          widthMethod: 'unicode',
        })
        buf.clear([0, 0, 0, 1])

        // ResizeObserver fires every pixel during drag-resize. Debounce so we
        // do one in-place resize after the user stops dragging, not 60/sec.
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
        let frame = 0

        const tick = () => {
          if (disposed || !term || !buf || !opentuiExports) return
          const now = performance.now()
          const t = (now - startedAt) / 1000
          try {
            drawRef.current({ buf, opentui: opentuiExports, term, t, frame })
            term.write(encodeBufferAsAnsi(buf, { clearScreen: frame === 0 }))
          } catch (e) {
            setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
            setStatus('error')
            return // stop the loop on first throw so we don't spam errors
          }
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
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      resizeObserver?.disconnect()
      if (term && hideCursor) {
        try { term.write('\x1b[?25h') } catch {}
      }
      buf?.destroy()
      term?.dispose()
    }
  }, [hideCursor, background, fontSize])

  return { hostRef, status, error, fps }
}
