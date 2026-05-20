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
  // Optional: handle keystrokes from ghostty-web. Bytes as written by the
  // terminal (raw, including escapes for arrows etc.).
  onData?: (data: string, ctx: { opentui: OpentuiExports }) => void
  // Stable identity not required — captured via ref each frame.
  draw: DrawFn
}

// Mounts ghostty-web, sizes itself to the container via FitAddon + ResizeObserver,
// loads opentui WASM, and drives an rAF loop. Demos read width/height from
// the buf inside the draw callback instead of hardcoded constants.
export function useOpentuiTerminal(opts: Options) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [dims, setDims] = useState<{ cols: number; rows: number } | null>(null)

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
    let lastCols = 0
    let lastRows = 0

    function rebuildBuffer() {
      if (!term || !opentuiExports) return
      if (term.cols === lastCols && term.rows === lastRows) return
      lastCols = term.cols
      lastRows = term.rows
      buf?.destroy()
      buf = OpentuiBuffer.create(opentuiExports, term.cols, term.rows, {
        id: 'demo',
        widthMethod: 'unicode',
      })
      buf.clear([0, 0, 0, 1])
      setDims({ cols: term.cols, rows: term.rows })
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
          const t = term
          term.onData((data) => onDataRef.current?.(data, { opentui }))
          void t
        }

        // First fit and buffer create.
        try { fit.fit() } catch {}
        rebuildBuffer()

        // Observe container size; refit + rebuild buffer on resize.
        resizeObserver = new ResizeObserver(() => {
          if (!fit || !term) return
          try { fit.fit() } catch {}
          rebuildBuffer()
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
          drawRef.current({ buf, opentui: opentuiExports, term, t, frame })
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
      resizeObserver?.disconnect()
      if (term && hideCursor) {
        try { term.write('\x1b[?25h') } catch {}
      }
      buf?.destroy()
      term?.dispose()
    }
    // Restart only when these visual-bootstrap concerns change. drawRef and
    // onDataRef are stable across renders and pick up new closures via the refs.
  }, [hideCursor, background, fontSize])

  return { hostRef, status, error, fps, dims }
}
