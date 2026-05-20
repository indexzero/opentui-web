// Reusable rendering-pipeline variants for any cell-grid demo.
//
// Each component takes a `draw(buf, t)` kernel and handles its own host div +
// rAF loop + resize. They share the same `<VariantFrame>` chrome so swapping
// between them looks consistent.

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { FitAddon, Terminal as GhosttyTerminal, init as initGhostty } from 'ghostty-web'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon as XtermFitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { CanvasPainter, OpentuiBuffer, encodeBufferAsAnsi, loadOpentui } from 'opentui-browser'

export type DrawKernel = (buf: OpentuiBuffer, t: number, frame: number) => void

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

// ---- shared chrome --------------------------------------------------------

interface VariantFrameProps {
  hostRef: RefObject<HTMLDivElement | null>
  status: 'loading' | 'ready' | 'error'
  fps: number
  error: string | null
  detail?: string
}

export function VariantFrame({ hostRef, status, fps, error, detail }: VariantFrameProps) {
  return (
    <>
      <div className="mb-1 flex items-center justify-end font-mono text-xs text-white/40">
        {detail ? <span className="mr-3">{detail}</span> : null}
        <span className={status === 'ready' ? 'text-[#9ece6a]' : 'text-white/50'}>{status}</span>
        {status === 'ready' ? <span className="ml-3 text-[#7aa2f7]">{fps} fps</span> : null}
        {error ? <span className="ml-3 text-[#f7768e]">{error}</span> : null}
      </div>
      <div ref={hostRef} className="flex-1 overflow-hidden rounded-md border border-white/5" />
    </>
  )
}

// ---- ghostty on main thread -----------------------------------------------

interface DrawProps {
  draw: DrawKernel
}

export function GhosttyVariant({ draw }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    let term: GhosttyTerminal | undefined
    let buf: OpentuiBuffer | undefined
    let fit: FitAddon | undefined
    let ro: ResizeObserver | undefined
    let resizeTimeout = 0
    let rafId = 0
    let disposed = false

    function syncSize() {
      if (!term || !buf || !fit) return
      try { fit.fit() } catch { return }
      if (term.cols !== buf.width || term.rows !== buf.height) {
        buf.resize(term.cols, term.rows)
        buf.clear([0, 0, 0, 1])
      }
    }

    Promise.all([ensureGhostty(), loadOpentui()]).then(([, opentui]) => {
      if (disposed || !hostRef.current) return
      term = new GhosttyTerminal({
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: { background: '#0b0b14', foreground: '#c0caf5', cursor: '#7aa2f7' },
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)
      term.write('\x1b[?25l')
      try { fit.fit() } catch {}
      buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), { id: 'variant', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, firstFrame = true, frame = 0
      const tick = () => {
        if (disposed || !term || !buf) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame)
          term.write(encodeBufferAsAnsi(buf, { clearScreen: firstFrame }))
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e)); setStatus('error'); return
        }
        firstFrame = false
        frame++
        framesThisSecond++
        if (now - lastSecond >= 1000) { setFps(framesThisSecond); framesThisSecond = 0; lastSecond = now }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    }).catch((err) => { setError(err?.message ?? String(err)); setStatus('error') })

    return () => {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      ro?.disconnect()
      try { term?.write('\x1b[?25h') } catch {}
      buf?.destroy()
      term?.dispose()
    }
  }, [])

  return <VariantFrame hostRef={hostRef} status={status} fps={fps} error={error} detail="ghostty-web · main thread" />
}

// ---- ghostty + worker -----------------------------------------------------

interface WorkerProps {
  workerFactory: () => Worker
}

export function GhosttyWorkerVariant({ workerFactory }: WorkerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [computeMs, setComputeMs] = useState(0)

  useEffect(() => {
    let term: GhosttyTerminal | undefined
    let fit: FitAddon | undefined
    let worker: Worker | undefined
    let ro: ResizeObserver | undefined
    let resizeTimeout = 0
    let rafId = 0
    let disposed = false
    let workerReady = false
    let nextSeq = 0, inflight = 0
    let startedAt = 0, lastSecond = 0, framesThisSecond = 0, lastComputeMs = 0

    function syncSize() {
      if (!term || !fit || !worker) return
      try { fit.fit() } catch { return }
      worker.postMessage({ type: 'resize', cols: term.cols, rows: term.rows })
    }

    ensureGhostty().then(() => {
      if (disposed || !hostRef.current) return
      worker = workerFactory()
      worker.onerror = (ev) => { setError(`worker ${ev.message ?? ''}`); setStatus('error') }
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'ready') { workerReady = true; syncSize() }
        else if (m.type === 'frame') {
          inflight = Math.max(0, inflight - 1)
          if (!term || disposed) return
          try { term.write(new Uint8Array(m.bytes)) } catch (err) {
            setError(err instanceof Error ? err.message : String(err)); setStatus('error'); return
          }
          lastComputeMs = m.computeMs
          framesThisSecond++
          const now = performance.now()
          if (now - lastSecond >= 1000) {
            setFps(framesThisSecond); setComputeMs(Math.round(lastComputeMs * 10) / 10)
            framesThisSecond = 0; lastSecond = now
          }
        } else if (m.type === 'error') { setError(m.message); setStatus('error') }
      }
      worker.postMessage({ type: 'init' })

      term = new GhosttyTerminal({
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: { background: '#0b0b14', foreground: '#c0caf5', cursor: '#7aa2f7' },
      })
      fit = new FitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)
      term.write('\x1b[?25l')
      try { fit.fit() } catch {}
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      startedAt = performance.now(); lastSecond = startedAt
      const tick = () => {
        if (disposed) return
        while (workerReady && worker && inflight < 2) {
          worker.postMessage({ type: 'frame', t: (performance.now() - startedAt) / 1000, seq: nextSeq++ })
          inflight++
        }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    }).catch((err) => { setError(err?.message ?? String(err)); setStatus('error') })

    return () => {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      ro?.disconnect()
      worker?.postMessage({ type: 'dispose' })
      worker?.terminate()
      try { term?.write('\x1b[?25h') } catch {}
      term?.dispose()
    }
  }, [])

  return <VariantFrame hostRef={hostRef} status={status} fps={fps} error={error} detail={`worker compute ${computeMs}ms · 2 frames in flight`} />
}

// ---- xterm.js -------------------------------------------------------------

export function XtermVariant({ draw }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [renderer, setRenderer] = useState<'webgl' | 'canvas'>('webgl')
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let term: XtermTerminal | undefined
    let fit: XtermFitAddon | undefined
    let webgl: WebglAddon | undefined
    let ro: ResizeObserver | undefined
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

    loadOpentui().then((opentui) => {
      if (disposed || !hostRef.current) return
      term = new XtermTerminal({
        fontSize: 13,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        theme: { background: '#0b0b14', foreground: '#c0caf5' },
        cursorBlink: false,
        disableStdin: true,
        allowProposedApi: true,
      })
      fit = new XtermFitAddon()
      term.loadAddon(fit)
      term.open(hostRef.current)
      try {
        webgl = new WebglAddon()
        term.loadAddon(webgl)
        webgl.onContextLoss(() => { webgl?.dispose() })
        setRenderer('webgl')
      } catch { setRenderer('canvas') }
      term.write('\x1b[?25l')
      try { fit.fit() } catch {}
      buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), { id: 'variant-xterm', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, firstFrame = true, frame = 0
      const tick = () => {
        if (disposed || !term || !buf) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame)
          term.write(encodeBufferAsAnsi(buf, { clearScreen: firstFrame }))
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e)); setStatus('error'); return
        }
        firstFrame = false
        frame++
        framesThisSecond++
        if (now - lastSecond >= 1000) { setFps(framesThisSecond); framesThisSecond = 0; lastSecond = now }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    }).catch((err) => { setError(err?.message ?? String(err)); setStatus('error') })

    return () => {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      ro?.disconnect()
      webgl?.dispose()
      buf?.destroy()
      term?.dispose()
    }
  }, [])

  return <VariantFrame hostRef={hostRef} status={status} fps={fps} error={error} detail={`xterm.js v6 · ${renderer}`} />
}

// ---- direct canvas paint --------------------------------------------------

export function CanvasVariant({ draw }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [cellInfo, setCellInfo] = useState('')
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let painter: CanvasPainter | undefined
    let canvas: HTMLCanvasElement | undefined
    let ro: ResizeObserver | undefined
    let resizeTimeout = 0
    let rafId = 0
    let disposed = false

    function syncSize() {
      if (!painter || !buf || !hostRef.current) return
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      if (cols !== buf.width || rows !== buf.height) {
        buf.resize(cols, rows); buf.clear([0, 0, 0, 1])
      }
      setCellInfo(`${cols}x${rows}`)
    }

    loadOpentui().then((opentui) => {
      if (disposed || !hostRef.current) return
      canvas = document.createElement('canvas')
      canvas.style.display = 'block'
      hostRef.current.appendChild(canvas)
      painter = new CanvasPainter(canvas, { fontSize: 13 })
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'variant-canvas', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      setCellInfo(`${cols}x${rows}`)
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, frame = 0
      const tick = () => {
        if (disposed || !buf || !painter) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame)
          painter.paint(buf)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e)); setStatus('error'); return
        }
        frame++
        framesThisSecond++
        if (now - lastSecond >= 1000) { setFps(framesThisSecond); framesThisSecond = 0; lastSecond = now }
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    }).catch((err) => { setError(err?.message ?? String(err)); setStatus('error') })

    return () => {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      ro?.disconnect()
      buf?.destroy()
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  return <VariantFrame hostRef={hostRef} status={status} fps={fps} error={error} detail={`direct canvas · no terminal emulator · ${cellInfo}`} />
}
