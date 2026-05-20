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
import {
  CanvasGLPainter,
  CanvasGPUPainter,
  CanvasPainter,
  OpentuiBuffer,
  encodeBufferAsAnsi,
  encodeBufferAsAnsiDiff,
  gridFromMessage,
  gridToText,
  loadOpentui,
} from 'opentui-browser'
import type { CellGrid, OpentuiExports } from 'opentui-browser'

// Copy the buffer's visible text to the clipboard. Triggered by Cmd/Ctrl+C
// in the canvas variants; the terminal-emulator variants get this for free
// from ghostty/xterm's own selection model.
function copyGridToClipboard(grid: CellGrid | null) {
  if (!grid) return
  navigator.clipboard.writeText(gridToText(grid)).catch(() => {
    /* clipboard write blocked — ignore */
  })
}

function isCopyCombo(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c'
}

export type DrawKernel = (buf: OpentuiBuffer, t: number, frame: number, opentui: OpentuiExports) => void
export type EncoderMode = 'full' | 'diff'

function encode(buf: OpentuiBuffer, mode: EncoderMode, clearScreen: boolean): string {
  return mode === 'diff'
    ? encodeBufferAsAnsiDiff(buf, { clearScreen })
    : encodeBufferAsAnsi(buf, { clearScreen })
}

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

// ---- shared chrome --------------------------------------------------------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

interface VariantFrameProps {
  hostRef: RefObject<HTMLDivElement | null>
  status: 'loading' | 'ready' | 'error'
  fps: number
  error: string | null
  detail?: string
  bytesPerFrame?: number
  encoderMode?: EncoderMode
}

export function VariantFrame({ hostRef, status, fps, error, detail, bytesPerFrame, encoderMode }: VariantFrameProps) {
  return (
    <>
      <div className="mb-1 flex items-center justify-end font-mono text-xs text-white/40">
        {detail ? <span className="mr-3">{detail}</span> : null}
        <span className={status === 'ready' ? 'text-[#9ece6a]' : 'text-white/50'}>{status}</span>
        {status === 'ready' ? <span className="ml-3 text-[#7aa2f7]">{fps} fps</span> : null}
        {status === 'ready' && bytesPerFrame !== undefined && bytesPerFrame > 0 ? (
          <span className="ml-3 text-white/60">
            {formatBytes(bytesPerFrame)}/frame
            {encoderMode === 'diff' ? <span className="ml-1 text-[#bb9af7]">diff</span> : null}
          </span>
        ) : null}
        {error ? <span className="ml-3 text-[#f7768e]">{error}</span> : null}
      </div>
      <div ref={hostRef} className="flex-1 overflow-hidden rounded-md border border-white/5" />
    </>
  )
}

// ---- ghostty on main thread -----------------------------------------------

interface DrawProps {
  draw: DrawKernel
  encoderMode?: EncoderMode
  // Receives raw input bytes (same shape as ghostty/xterm's onData). Each
  // variant wires its native input source here; the worker variant forwards
  // these via postMessage so the worker-side kernel sees them.
  onInput?: (data: string) => void
}

export function GhosttyVariant({ draw, encoderMode = 'full', onInput }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [bytesPerFrame, setBytesPerFrame] = useState(0)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

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
      if (onInputRef.current) {
        term.onData((d) => onInputRef.current?.(d))
      }
      buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), { id: 'variant', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, firstFrame = true, frame = 0, lastBytes = 0
      const tick = () => {
        if (disposed || !term || !buf) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame, opentui)
          const out = encode(buf, encoderMode, firstFrame)
          lastBytes = out.length
          term.write(out)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e)); setStatus('error'); return
        }
        firstFrame = false
        frame++
        framesThisSecond++
        if (now - lastSecond >= 1000) {
          setFps(framesThisSecond)
          setBytesPerFrame(lastBytes)
          framesThisSecond = 0
          lastSecond = now
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
      try { term?.write('\x1b[?25h') } catch {}
      buf?.destroy()
      term?.dispose()
    }
  }, [encoderMode])

  return (
    <VariantFrame
      hostRef={hostRef}
      status={status}
      fps={fps}
      bytesPerFrame={bytesPerFrame}
      encoderMode={encoderMode}
      error={error}
      detail="ghostty-web · main thread"
    />
  )
}

// ---- ghostty + worker -----------------------------------------------------

interface WorkerProps {
  workerFactory: () => Worker
  encoderMode?: EncoderMode
  // If set, the variant will forward keystrokes (via term.onData) to the worker
  // as `{ type: 'input', data }` postMessage. The worker's run-worker.ts
  // receives them and dispatches to a kernel-supplied input handler.
  forwardInput?: boolean
}

export function GhosttyWorkerVariant({ workerFactory, encoderMode = 'full', forwardInput }: WorkerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [computeMs, setComputeMs] = useState(0)
  const [bytesPerFrame, setBytesPerFrame] = useState(0)

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
    let startedAt = 0, lastSecond = 0, framesThisSecond = 0, lastComputeMs = 0, lastBytes = 0

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
          try {
            const bytes = new Uint8Array(m.bytes)
            lastBytes = bytes.length
            term.write(bytes)
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err)); setStatus('error'); return
          }
          lastComputeMs = m.computeMs
          framesThisSecond++
          const now = performance.now()
          if (now - lastSecond >= 1000) {
            setFps(framesThisSecond)
            setComputeMs(Math.round(lastComputeMs * 10) / 10)
            setBytesPerFrame(lastBytes)
            framesThisSecond = 0; lastSecond = now
          }
        } else if (m.type === 'error') { setError(m.message); setStatus('error') }
      }
      worker.postMessage({ type: 'init', encoderMode })

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
      if (forwardInput) {
        term.onData((d) => worker?.postMessage({ type: 'input', data: d }))
      }
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
  }, [encoderMode, forwardInput])

  return (
    <VariantFrame
      hostRef={hostRef}
      status={status}
      fps={fps}
      bytesPerFrame={bytesPerFrame}
      encoderMode={encoderMode}
      error={error}
      detail={`worker compute ${computeMs}ms · 2 frames in flight`}
    />
  )
}

// ---- xterm.js -------------------------------------------------------------

export function XtermVariant({ draw, encoderMode = 'full', onInput }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [bytesPerFrame, setBytesPerFrame] = useState(0)
  const [renderer, setRenderer] = useState<'webgl' | 'canvas'>('webgl')
  const drawRef = useRef(draw)
  drawRef.current = draw
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

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
        disableStdin: !onInputRef.current,
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
      if (onInputRef.current) {
        term.onData((d) => onInputRef.current?.(d))
      }
      buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), { id: 'variant-xterm', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, firstFrame = true, frame = 0, lastBytes = 0
      const tick = () => {
        if (disposed || !term || !buf) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame, opentui)
          const out = encode(buf, encoderMode, firstFrame)
          lastBytes = out.length
          term.write(out)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e)); setStatus('error'); return
        }
        firstFrame = false
        frame++
        framesThisSecond++
        if (now - lastSecond >= 1000) {
          setFps(framesThisSecond)
          setBytesPerFrame(lastBytes)
          framesThisSecond = 0; lastSecond = now
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
      webgl?.dispose()
      buf?.destroy()
      term?.dispose()
    }
  }, [encoderMode])

  return (
    <VariantFrame
      hostRef={hostRef}
      status={status}
      fps={fps}
      bytesPerFrame={bytesPerFrame}
      encoderMode={encoderMode}
      error={error}
      detail={`xterm.js v6 · ${renderer}`}
    />
  )
}

// ---- direct canvas paint --------------------------------------------------

export function CanvasVariant({ draw, onInput }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [cellInfo, setCellInfo] = useState('')
  const drawRef = useRef(draw)
  drawRef.current = draw
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let painter: CanvasPainter | undefined
    let canvas: HTMLCanvasElement | undefined
    let ro: ResizeObserver | undefined
    let keyHandler: ((e: KeyboardEvent) => void) | undefined
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

      // Keyboard input — translate DOM KeyboardEvents into the same byte
      // sequences ghostty / xterm produce via term.onData. The canvas needs
      // focus to receive keys; we make it focusable + auto-focus.
      canvas.tabIndex = 0
      canvas.style.outline = 'none'
      canvas.focus()
      keyHandler = (e: KeyboardEvent) => {
        if (document.activeElement !== canvas) return
        if (isCopyCombo(e)) {
          e.preventDefault()
          copyGridToClipboard(buf ? buf.snapshot() : null)
          return
        }
        if (!onInputRef.current) return
        const bytes = keyEventToBytes(e)
        if (bytes !== null) {
          e.preventDefault()
          onInputRef.current(bytes)
        }
      }
      window.addEventListener('keydown', keyHandler)

      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, frame = 0
      const tick = () => {
        if (disposed || !buf || !painter) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame, opentui)
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
      if (keyHandler) window.removeEventListener('keydown', keyHandler)
      buf?.destroy()
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  return <VariantFrame hostRef={hostRef} status={status} fps={fps} error={error} detail={`direct canvas · no terminal emulator · ${cellInfo}`} />
}

// ---- canvas + worker -----------------------------------------------------

type CanvasWorkerKind = '2d' | 'gl' | 'gpu'

interface CanvasWorkerProps {
  workerFactory: () => Worker
  kind: CanvasWorkerKind
  forwardInput?: boolean
}

function CanvasWorkerVariantInner({ workerFactory, kind, forwardInput }: CanvasWorkerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [computeMs, setComputeMs] = useState(0)
  const [cellInfo, setCellInfo] = useState('')

  useEffect(() => {
    let canvas: HTMLCanvasElement | undefined
    let painter: CanvasPainter | CanvasGLPainter | CanvasGPUPainter | undefined
    let worker: Worker | undefined
    let ro: ResizeObserver | undefined
    let keyHandler: ((e: KeyboardEvent) => void) | undefined
    let resizeTimeout = 0
    let rafId = 0
    let disposed = false
    let workerReady = false
    let nextSeq = 0, inflight = 0
    let lastSecond = performance.now(), framesThisSecond = 0, lastComputeMs = 0
    let lastGrid: CellGrid | null = null

    function syncSize() {
      if (!painter || !hostRef.current || !worker) return
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      setCellInfo(`${cols}x${rows}`)
      worker.postMessage({ type: 'resize', cols, rows })
    }

    canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    if (!hostRef.current) return
    hostRef.current.appendChild(canvas)

    const setupPainter = async (): Promise<CanvasPainter | CanvasGLPainter | CanvasGPUPainter> => {
      if (kind === 'gpu') {
        const p = new CanvasGPUPainter(canvas!, { fontSize: 13 })
        await p.init()
        return p
      }
      if (kind === 'gl') return new CanvasGLPainter(canvas!, { fontSize: 13 })
      return new CanvasPainter(canvas!, { fontSize: 13 })
    }
    const proceed = () => {
      if (!painter || !hostRef.current || !canvas) return
    worker = workerFactory()
    worker.onerror = (ev) => { setError(`worker ${ev.message ?? ''}`); setStatus('error') }
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'ready') {
        workerReady = true
        syncSize()
      } else if (m.type === 'frame' && m.mode === 'cells') {
        inflight = Math.max(0, inflight - 1)
        if (!painter || disposed) return
        try {
          const grid: CellGrid = gridFromMessage(m.cells)
          lastGrid = grid
          painter.paint(grid)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err)); setStatus('error'); return
        }
        lastComputeMs = m.computeMs
        framesThisSecond++
        const now = performance.now()
        if (now - lastSecond >= 1000) {
          setFps(framesThisSecond)
          setComputeMs(Math.round(lastComputeMs * 10) / 10)
          framesThisSecond = 0
          lastSecond = now
        }
      } else if (m.type === 'error') {
        setError(m.message); setStatus('error')
      }
    }
    worker.postMessage({ type: 'init', outputMode: 'cells' })

    canvas.tabIndex = 0
    canvas.style.outline = 'none'
    canvas.focus()
    keyHandler = (e: KeyboardEvent) => {
      if (document.activeElement !== canvas) return
      if (isCopyCombo(e)) {
        e.preventDefault()
        copyGridToClipboard(lastGrid)
        return
      }
      if (!forwardInput) return
      const bytes = keyEventToBytes(e)
      if (bytes !== null) {
        e.preventDefault()
        worker?.postMessage({ type: 'input', data: bytes })
      }
    }
    window.addEventListener('keydown', keyHandler)

    ro = new ResizeObserver(() => {
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
    })
    ro.observe(hostRef.current)
    setError(null); setStatus('ready')

    const startedAt = performance.now()
    lastSecond = startedAt
    const tick = () => {
      if (disposed) return
      while (workerReady && worker && inflight < 2) {
        worker.postMessage({ type: 'frame', t: (performance.now() - startedAt) / 1000, seq: nextSeq++ })
        inflight++
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    }

    setupPainter().then((p) => {
      if (disposed) { p.dispose(); return }
      painter = p
      proceed()
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    })

    return () => {
      disposed = true
      if (rafId) cancelAnimationFrame(rafId)
      if (resizeTimeout) window.clearTimeout(resizeTimeout)
      ro?.disconnect()
      if (keyHandler) window.removeEventListener('keydown', keyHandler)
      worker?.postMessage({ type: 'dispose' })
      worker?.terminate()
      ;(painter as { dispose?: () => void } | undefined)?.dispose?.()
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [forwardInput])

  const kindLabel = kind === 'gl' ? 'WebGL2' : kind === 'gpu' ? 'WebGPU' : 'canvas2d'
  return (
    <VariantFrame
      hostRef={hostRef}
      status={status}
      fps={fps}
      error={error}
      detail={`${kindLabel} · worker compute ${computeMs}ms · ${cellInfo}`}
    />
  )
}

export function CanvasWorkerVariant(props: { workerFactory: () => Worker; forwardInput?: boolean }) {
  return <CanvasWorkerVariantInner workerFactory={props.workerFactory} kind="2d" forwardInput={props.forwardInput} />
}

export function CanvasGLWorkerVariant(props: { workerFactory: () => Worker; forwardInput?: boolean }) {
  return <CanvasWorkerVariantInner workerFactory={props.workerFactory} kind="gl" forwardInput={props.forwardInput} />
}

export function CanvasGPUWorkerVariant(props: { workerFactory: () => Worker; forwardInput?: boolean }) {
  return <CanvasWorkerVariantInner workerFactory={props.workerFactory} kind="gpu" forwardInput={props.forwardInput} />
}

// ---- WebGL canvas paint ---------------------------------------------------

export function CanvasGLVariant({ draw, onInput }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [cellInfo, setCellInfo] = useState('')
  const drawRef = useRef(draw)
  drawRef.current = draw
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let painter: CanvasGLPainter | undefined
    let canvas: HTMLCanvasElement | undefined
    let ro: ResizeObserver | undefined
    let keyHandler: ((e: KeyboardEvent) => void) | undefined
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
      try {
        painter = new CanvasGLPainter(canvas, { fontSize: 13 })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
        return
      }
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'variant-gl', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      setCellInfo(`${cols}x${rows}`)
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)

      canvas.tabIndex = 0
      canvas.style.outline = 'none'
      canvas.focus()
      keyHandler = (e: KeyboardEvent) => {
        if (document.activeElement !== canvas) return
        if (isCopyCombo(e)) {
          e.preventDefault()
          copyGridToClipboard(buf ? buf.snapshot() : null)
          return
        }
        if (!onInputRef.current) return
        const bytes = keyEventToBytes(e)
        if (bytes !== null) {
          e.preventDefault()
          onInputRef.current(bytes)
        }
      }
      window.addEventListener('keydown', keyHandler)

      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, frame = 0
      const tick = () => {
        if (disposed || !buf || !painter) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame, opentui)
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
      if (keyHandler) window.removeEventListener('keydown', keyHandler)
      painter?.dispose()
      buf?.destroy()
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  return <VariantFrame hostRef={hostRef} status={status} fps={fps} error={error} detail={`WebGL2 · instanced quads · ${cellInfo}`} />
}

// ---- WebGPU canvas paint --------------------------------------------------

export function CanvasGPUVariant({ draw, onInput }: DrawProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [cellInfo, setCellInfo] = useState('')
  const drawRef = useRef(draw)
  drawRef.current = draw
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let painter: CanvasGPUPainter | undefined
    let canvas: HTMLCanvasElement | undefined
    let ro: ResizeObserver | undefined
    let keyHandler: ((e: KeyboardEvent) => void) | undefined
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

    Promise.all([loadOpentui(), (async () => {
      if (!hostRef.current) return null
      canvas = document.createElement('canvas')
      canvas.style.display = 'block'
      hostRef.current.appendChild(canvas)
      try {
        painter = new CanvasGPUPainter(canvas, { fontSize: 13 })
        await painter.init()
      } catch (e) {
        throw e
      }
      return painter
    })()]).then(([opentui]) => {
      if (disposed || !hostRef.current || !painter || !canvas) return
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'variant-gpu', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      setCellInfo(`${cols}x${rows}`)
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)

      if (onInputRef.current) {
        const c = canvas
        c.tabIndex = 0
        c.style.outline = 'none'
        c.focus()
        keyHandler = (e: KeyboardEvent) => {
          if (document.activeElement !== c) return
          const bytes = keyEventToBytes(e)
          if (bytes !== null) {
            e.preventDefault()
            onInputRef.current?.(bytes)
          }
        }
        window.addEventListener('keydown', keyHandler)
      }

      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, frame = 0
      const tick = () => {
        if (disposed || !buf || !painter) return
        const now = performance.now()
        try {
          drawRef.current(buf, (now - startedAt) / 1000, frame, opentui)
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
      if (keyHandler) window.removeEventListener('keydown', keyHandler)
      painter?.dispose()
      buf?.destroy()
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    }
  }, [])

  return <VariantFrame hostRef={hostRef} status={status} fps={fps} error={error} detail={`WebGPU · instanced quads · ${cellInfo}`} />
}

// Map a DOM KeyboardEvent to the same byte sequence ghostty/xterm would
// hand to onData. Returns null for keys we don't recognize (caller should
// let them fall through to the browser).
function keyEventToBytes(e: KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    // Ctrl-letter → ASCII control codes (Ctrl-A = \x01, etc.)
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const c = e.key.toLowerCase().charCodeAt(0)
      if (c >= 0x61 && c <= 0x7a) return String.fromCharCode(c - 0x60)
    }
    return null
  }
  switch (e.key) {
    case 'Backspace': return '\x7f'
    case 'Enter': return '\r'
    case 'Tab': return '\t'
    case 'Escape': return '\x1b'
    case 'ArrowUp': return '\x1b[A'
    case 'ArrowDown': return '\x1b[B'
    case 'ArrowRight': return '\x1b[C'
    case 'ArrowLeft': return '\x1b[D'
    case 'Delete': return '\x1b[3~'
    case 'Home': return '\x1b[H'
    case 'End': return '\x1b[F'
  }
  if (e.key.length === 1) return e.key
  return null
}
