import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { FitAddon, Terminal as GhosttyTerminal, init as initGhostty } from 'ghostty-web'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { FitAddon as XtermFitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { CanvasPainter, OpentuiBuffer, encodeBufferAsAnsi, loadOpentui } from 'opentui-browser'
import { drawPlasma } from '../demo-lib/plasma-kernel'
import { VariantToggle } from '../demo-lib/VariantToggle'

export const Route = createFileRoute('/plasma')({ component: PlasmaPage })

type Variant = 'ghostty' | 'ghostty-worker' | 'xterm' | 'canvas'

const VARIANTS: ReadonlyArray<{ key: Variant; label: string; hint: string }> = [
  { key: 'ghostty', label: 'ghostty', hint: 'ghostty-web on main thread (default)' },
  { key: 'ghostty-worker', label: 'ghostty / worker', hint: 'opentui compute in a Worker, ghostty-web paints' },
  { key: 'xterm', label: 'xterm.js', hint: 'xterm.js v6 with WebGL addon' },
  { key: 'canvas', label: 'canvas', hint: 'direct 2d canvas paint, no terminal emulator' },
]

function PlasmaPage() {
  const [variant, setVariant] = useState<Variant>('ghostty')
  return (
    <div className="flex flex-1 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <span className="font-mono text-sm">plasma</span>
          <span className="ml-3 font-mono text-xs text-white/40">
            same kernel · pick a rendering pipeline
          </span>
        </div>
        <VariantToggle value={variant} options={VARIANTS} onChange={setVariant} />
      </div>
      {/* `key` ensures full unmount/remount when variant changes — no leftover state */}
      {variant === 'ghostty' && <PlasmaGhostty key="ghostty" />}
      {variant === 'ghostty-worker' && <PlasmaGhosttyWorker key="ghostty-worker" />}
      {variant === 'xterm' && <PlasmaXterm key="xterm" />}
      {variant === 'canvas' && <PlasmaCanvas key="canvas" />}
    </div>
  )
}

// ----- shared variant chrome ------------------------------------------------

interface VariantFrameProps {
  hostRef: React.RefObject<HTMLDivElement | null>
  status: 'loading' | 'ready' | 'error'
  fps: number
  error: string | null
  detail?: string
}

function VariantFrame({ hostRef, status, fps, error, detail }: VariantFrameProps) {
  return (
    <>
      <div className="mb-1 flex items-center justify-end font-mono text-xs text-white/40">
        {detail ? <span className="mr-3">{detail}</span> : null}
        <span className={status === 'ready' ? 'text-[#9ece6a]' : 'text-white/50'}>{status}</span>
        {status === 'ready' ? <span className="ml-3 text-[#7aa2f7]">{fps} fps</span> : null}
        {error ? <span className="ml-3 text-[#f7768e]">{error}</span> : null}
      </div>
      <div
        ref={hostRef}
        className="flex-1 overflow-hidden rounded-md border border-white/5"
      />
    </>
  )
}

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

// ----- variant: ghostty on main thread --------------------------------------

function PlasmaGhostty() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)

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
      buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), { id: 'plasma', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, firstFrame = true
      const tick = () => {
        if (disposed || !term || !buf) return
        const now = performance.now()
        drawPlasma(buf, (now - startedAt) / 1000)
        term.write(encodeBufferAsAnsi(buf, { clearScreen: firstFrame }))
        firstFrame = false
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

// ----- variant: ghostty + worker --------------------------------------------

function PlasmaGhosttyWorker() {
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
      worker = new Worker(new URL('../workers/plasma-worker.ts', import.meta.url), { type: 'module' })
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
            setFps(framesThisSecond)
            setComputeMs(Math.round(lastComputeMs * 10) / 10)
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

// ----- variant: xterm.js ----------------------------------------------------

function PlasmaXterm() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [renderer, setRenderer] = useState<'webgl' | 'canvas'>('webgl')

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
      buf = OpentuiBuffer.create(opentui, Math.max(1, term.cols), Math.max(1, term.rows), { id: 'plasma-xterm', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0, firstFrame = true
      const tick = () => {
        if (disposed || !term || !buf) return
        const now = performance.now()
        drawPlasma(buf, (now - startedAt) / 1000)
        term.write(encodeBufferAsAnsi(buf, { clearScreen: firstFrame }))
        firstFrame = false
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

// ----- variant: direct canvas ----------------------------------------------

function PlasmaCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [cellInfo, setCellInfo] = useState('')

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
      buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'plasma-canvas', widthMethod: 'unicode' })
      buf.clear([0, 0, 0, 1])
      setCellInfo(`${cols}x${rows}`)
      ro = new ResizeObserver(() => {
        if (resizeTimeout) window.clearTimeout(resizeTimeout)
        resizeTimeout = window.setTimeout(() => { resizeTimeout = 0; syncSize() }, 120)
      })
      ro.observe(hostRef.current)
      setError(null); setStatus('ready')

      const startedAt = performance.now()
      let lastSecond = startedAt, framesThisSecond = 0
      const tick = () => {
        if (disposed || !buf || !painter) return
        const now = performance.now()
        drawPlasma(buf, (now - startedAt) / 1000)
        painter.paint(buf)
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
