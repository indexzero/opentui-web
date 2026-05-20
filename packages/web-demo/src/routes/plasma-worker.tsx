import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { FitAddon, Terminal, init as initGhostty } from 'ghostty-web'
import { DemoFrame } from '../demo-lib/DemoLayout'

export const Route = createFileRoute('/plasma-worker')({ component: PlasmaWorker })

const MAX_INFLIGHT = 2 // worker computes N+1 while main paints N

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

function PlasmaWorker() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [computeMs, setComputeMs] = useState(0)

  useEffect(() => {
    let term: Terminal | undefined
    let fit: FitAddon | undefined
    let worker: Worker | undefined
    let resizeObserver: ResizeObserver | undefined
    let resizeTimeout = 0
    let disposed = false
    let rafId = 0

    let nextSeq = 0
    let inflight = 0
    let workerReady = false
    let startedAt = 0
    let framesThisSecond = 0
    let lastSecond = 0
    let lastComputeMs = 0

    function syncSize() {
      if (!term || !fit || !worker) return
      try { fit.fit() } catch { return }
      worker.postMessage({ type: 'resize', cols: term.cols, rows: term.rows })
    }

    ensureGhostty()
      .then(() => {
        if (disposed || !hostRef.current) return

        worker = new Worker(new URL('../workers/plasma-worker.ts', import.meta.url), { type: 'module' })
        worker.onerror = (ev) => {
          const msg = `worker.onerror ${ev.message ?? ''} @ ${ev.filename ?? '?'}:${ev.lineno ?? '?'}`
          // eslint-disable-next-line no-console
          console.error('[plasma-worker]', msg, ev)
          setError(msg)
          setStatus('error')
        }
        worker.onmessageerror = (ev) => {
          // eslint-disable-next-line no-console
          console.error('[plasma-worker] messageerror', ev)
          setError('worker messageerror')
          setStatus('error')
        }
        worker.onmessage = (e: MessageEvent) => {
          const m = e.data
          if (m.type === 'ready') {
            workerReady = true
            syncSize()
          } else if (m.type === 'frame') {
            inflight = Math.max(0, inflight - 1)
            if (!term || disposed) return
            try {
              term.write(new Uint8Array(m.bytes))
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
              setStatus('error')
              return
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
            setError(m.message)
            setStatus('error')
          }
        }
        worker.postMessage({ type: 'init' })

        term = new Terminal({
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          theme: { background: '#0b0b14', foreground: '#c0caf5', cursor: '#7aa2f7' },
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        term.open(hostRef.current)
        term.write('\x1b[?25l')
        try { fit.fit() } catch {}

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

        startedAt = performance.now()
        lastSecond = startedAt

        const tick = () => {
          if (disposed) return
          // Keep MAX_INFLIGHT frames in flight so worker computes next while main paints current.
          while (workerReady && worker && inflight < MAX_INFLIGHT) {
            const t = (performance.now() - startedAt) / 1000
            worker.postMessage({ type: 'frame', t, seq: nextSeq++ })
            inflight++
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
      worker?.postMessage({ type: 'dispose' })
      worker?.terminate()
      if (term) {
        try { term.write('\x1b[?25h') } catch {}
      }
      term?.dispose()
    }
  }, [])

  return (
    <DemoFrame
      title="plasma-worker"
      subtitle={`worker computes + encodes · main paints · worker frame ${computeMs}ms`}
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
