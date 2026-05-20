import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { CanvasPainter, OpentuiBuffer, loadOpentui } from 'opentui-browser'
import type { RGBA } from 'opentui-browser'
export const Route = createFileRoute('/life')({ component: Life })

const UPPER_HALF_BLOCK = 0x2580
const BG: RGBA = [0.04, 0.04, 0.08, 1]
const DEAD: RGBA = [0.07, 0.07, 0.11, 1]
const ALIVE: RGBA = [0.49, 0.83, 0.94, 1] // cyan
const AGED: RGBA = [0.24, 0.34, 0.5, 1]

// A few interesting starting patterns to drop in.
const PATTERNS: Record<string, [number, number][]> = {
  glider: [
    [1, 0], [2, 1], [0, 2], [1, 2], [2, 2],
  ],
  pulsar: (() => {
    const cells: [number, number][] = []
    // standard 13×13 pulsar (period 3)
    const rows = [
      '..XXX...XXX..',
      '.............',
      'X....X.X....X',
      'X....X.X....X',
      'X....X.X....X',
      '..XXX...XXX..',
      '.............',
      '..XXX...XXX..',
      'X....X.X....X',
      'X....X.X....X',
      'X....X.X....X',
      '.............',
      '..XXX...XXX..',
    ]
    rows.forEach((row, y) => {
      ;[...row].forEach((c, x) => { if (c === 'X') cells.push([x, y]) })
    })
    return cells
  })(),
  acorn: [
    [1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2],
  ],
}

function Life() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [running, setRunning] = useState(true)
  const [generation, setGeneration] = useState(0)
  const [speed, setSpeed] = useState(15) // ticks per second

  // World state (per pixel, where pixels = cols × rows × 2 for half-block).
  const worldRef = useRef<{ cur: Uint8Array; next: Uint8Array; age: Uint8Array; cols: number; rows: number } | null>(null)
  const generationRef = useRef(0)
  const runningRef = useRef(running)
  const speedRef = useRef(speed)
  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { speedRef.current = speed }, [speed])

  // Refs to imperative bits set up in the effect; UI buttons use these.
  const apiRef = useRef<{
    randomize: () => void
    clear: () => void
    step: () => void
    drop: (pattern: keyof typeof PATTERNS) => void
  } | null>(null)

  useEffect(() => {
    let buf: OpentuiBuffer | undefined
    let painter: CanvasPainter | undefined
    let canvas: HTMLCanvasElement | undefined
    let rafId = 0
    let resizeObserver: ResizeObserver | undefined
    let resizeTimeout = 0
    let disposed = false
    let mouseDown = false
    let mousePainting: 'on' | 'off' = 'on'

    function ensureWorld(cols: number, rows: number) {
      // World grid is per pixel — cols × (rows × 2) so half-blocks give 2:1 vertical.
      const w = worldRef.current
      const pxCols = cols
      const pxRows = rows * 2
      if (w && w.cols === pxCols && w.rows === pxRows) return w
      const cur = new Uint8Array(pxCols * pxRows)
      const next = new Uint8Array(pxCols * pxRows)
      const age = new Uint8Array(pxCols * pxRows)
      // Seed with a pulsar near the top-left so the demo isn't empty.
      const pulsar = PATTERNS.pulsar!
      const ox = 4
      const oy = 4
      for (const [x, y] of pulsar) {
        const px = ox + x
        const py = oy + y
        if (px < pxCols && py < pxRows) cur[py * pxCols + px] = 1
      }
      const nw = { cur, next, age, cols: pxCols, rows: pxRows }
      worldRef.current = nw
      return nw
    }

    function step(world: NonNullable<typeof worldRef.current>) {
      const { cur, next, age, cols, rows } = world
      for (let y = 0; y < rows; y++) {
        const ym1 = y > 0 ? y - 1 : rows - 1
        const yp1 = y < rows - 1 ? y + 1 : 0
        for (let x = 0; x < cols; x++) {
          const xm1 = x > 0 ? x - 1 : cols - 1
          const xp1 = x < cols - 1 ? x + 1 : 0
          const n =
            cur[ym1 * cols + xm1]! + cur[ym1 * cols + x]! + cur[ym1 * cols + xp1]! +
            cur[y * cols + xm1]! + cur[y * cols + xp1]! +
            cur[yp1 * cols + xm1]! + cur[yp1 * cols + x]! + cur[yp1 * cols + xp1]!
          const i = y * cols + x
          const alive = cur[i]!
          const lives = alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0)
          next[i] = lives
          // Track age for color fading: alive cells age, dead cells fade to 0
          age[i] = lives ? Math.min(255, age[i]! + 8) : Math.max(0, age[i]! - 24)
        }
      }
      // Swap cur/next by copy (could double-buffer but allocation cost is once at start).
      cur.set(next)
      generationRef.current++
    }

    function drawWorld(world: NonNullable<typeof worldRef.current>) {
      if (!buf) return
      const { cur, age, cols } = world
      const bufCols = buf.width
      const bufRows = buf.height
      for (let y = 0; y < bufRows; y++) {
        for (let x = 0; x < bufCols; x++) {
          const ti = (y * 2) * cols + x
          const bi = (y * 2 + 1) * cols + x
          const top = cur[ti]!
          const bot = cur[bi]!
          const fg = top
            ? mix(ALIVE, AGED, 1 - age[ti]! / 255)
            : DEAD
          const bg = bot
            ? mix(ALIVE, AGED, 1 - age[bi]! / 255)
            : DEAD
          buf.setCell(x, y, UPPER_HALF_BLOCK, fg, bg, 0)
        }
      }
    }

    function syncSize() {
      if (!painter || !buf || !hostRef.current) return
      const rect = hostRef.current.getBoundingClientRect()
      const { cols, rows } = painter.fit(rect.width, rect.height)
      painter.resize(cols, rows)
      if (cols !== buf.width || rows !== buf.height) {
        buf.resize(cols, rows)
        buf.clear(BG)
      }
      ensureWorld(cols, rows)
    }

    function pixelFromEvent(e: PointerEvent | MouseEvent): { x: number; y: number } | null {
      if (!canvas || !painter) return null
      const rect = canvas.getBoundingClientRect()
      const cx = (e.clientX - rect.left) / painter.cellWidth
      const cy = (e.clientY - rect.top) / painter.cellHeight
      const x = Math.floor(cx)
      const y = Math.floor(cy * 2 + (cy % 1 < 0.5 ? 0 : 1)) // map into the doubled pixel grid
      const w = worldRef.current
      if (!w) return null
      if (x < 0 || x >= w.cols || y < 0 || y >= w.rows) return null
      return { x, y }
    }

    function setPixel(x: number, y: number, on: boolean) {
      const w = worldRef.current
      if (!w) return
      w.cur[y * w.cols + x] = on ? 1 : 0
      w.age[y * w.cols + x] = on ? 255 : 0
    }

    loadOpentui()
      .then((opentui) => {
        if (disposed || !hostRef.current) return
        canvas = document.createElement('canvas')
        canvas.style.display = 'block'
        canvas.style.cursor = 'crosshair'
        hostRef.current.appendChild(canvas)
        painter = new CanvasPainter(canvas, { fontSize: 13 })
        const rect = hostRef.current.getBoundingClientRect()
        const { cols, rows } = painter.fit(rect.width, rect.height)
        painter.resize(cols, rows)
        buf = OpentuiBuffer.create(opentui, cols, rows, { id: 'life', widthMethod: 'unicode' })
        buf.clear(BG)
        ensureWorld(cols, rows)

        // Mouse painting — pointerdown determines on/off based on the clicked
        // cell's current state, so drag-toggle does what you'd expect.
        canvas.addEventListener('pointerdown', (e) => {
          const p = pixelFromEvent(e)
          if (!p) return
          mouseDown = true
          const w = worldRef.current!
          const isOn = w.cur[p.y * w.cols + p.x]! === 1
          mousePainting = isOn ? 'off' : 'on'
          setPixel(p.x, p.y, mousePainting === 'on')
        })
        canvas.addEventListener('pointermove', (e) => {
          if (!mouseDown) return
          const p = pixelFromEvent(e)
          if (!p) return
          setPixel(p.x, p.y, mousePainting === 'on')
        })
        canvas.addEventListener('pointerup', () => { mouseDown = false })
        canvas.addEventListener('pointerleave', () => { mouseDown = false })

        apiRef.current = {
          randomize: () => {
            const w = worldRef.current!
            for (let i = 0; i < w.cur.length; i++) {
              w.cur[i] = Math.random() < 0.25 ? 1 : 0
              w.age[i] = w.cur[i] ? 255 : 0
            }
            generationRef.current = 0
            setGeneration(0)
          },
          clear: () => {
            const w = worldRef.current!
            w.cur.fill(0)
            w.age.fill(0)
            generationRef.current = 0
            setGeneration(0)
          },
          step: () => {
            const w = worldRef.current!
            step(w)
          },
          drop: (pattern) => {
            const w = worldRef.current!
            const cells = PATTERNS[pattern]
            if (!cells) return
            // drop centered
            let maxX = 0, maxY = 0
            for (const [x, y] of cells) { if (x > maxX) maxX = x; if (y > maxY) maxY = y }
            const ox = Math.floor((w.cols - maxX) / 2)
            const oy = Math.floor((w.rows - maxY) / 2)
            for (const [x, y] of cells) {
              const px = ox + x
              const py = oy + y
              if (px >= 0 && px < w.cols && py >= 0 && py < w.rows) {
                w.cur[py * w.cols + px] = 1
                w.age[py * w.cols + px] = 255
              }
            }
          },
        }

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

        // Simulation tick is decoupled from render — paint at rAF, advance at speedRef hz.
        let lastSim = performance.now()
        let lastSecond = performance.now()
        let framesThisSecond = 0
        let lastReportedGen = 0

        const tick = () => {
          if (disposed || !buf || !painter || !worldRef.current) return
          const now = performance.now()
          if (runningRef.current) {
            const period = 1000 / Math.max(1, speedRef.current)
            while (now - lastSim >= period) {
              step(worldRef.current)
              lastSim += period
            }
          } else {
            lastSim = now
          }
          drawWorld(worldRef.current)
          painter.paint(buf)
          framesThisSecond++
          if (now - lastSecond >= 1000) {
            setFps(framesThisSecond)
            framesThisSecond = 0
            lastSecond = now
            if (generationRef.current !== lastReportedGen) {
              setGeneration(generationRef.current)
              lastReportedGen = generationRef.current
            }
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
    <div className="flex flex-1 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <span className="font-mono text-sm">life</span>
          <span className="ml-3 font-mono text-xs text-white/40">
            click / drag to paint · gen {generation}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            className="rounded bg-white/10 px-2 py-0.5 text-white hover:bg-white/20"
          >
            {running ? 'pause' : 'play'}
          </button>
          <button
            type="button"
            onClick={() => apiRef.current?.step()}
            className="rounded bg-white/10 px-2 py-0.5 text-white hover:bg-white/20"
          >
            step
          </button>
          <button
            type="button"
            onClick={() => apiRef.current?.randomize()}
            className="rounded bg-white/10 px-2 py-0.5 text-white hover:bg-white/20"
          >
            random
          </button>
          <button
            type="button"
            onClick={() => apiRef.current?.clear()}
            className="rounded bg-white/10 px-2 py-0.5 text-white hover:bg-white/20"
          >
            clear
          </button>
          <button
            type="button"
            onClick={() => apiRef.current?.drop('pulsar')}
            className="rounded bg-white/10 px-2 py-0.5 text-white hover:bg-white/20"
          >
            pulsar
          </button>
          <button
            type="button"
            onClick={() => apiRef.current?.drop('glider')}
            className="rounded bg-white/10 px-2 py-0.5 text-white hover:bg-white/20"
          >
            glider
          </button>
          <label className="ml-2 flex items-center gap-1 text-white/50">
            <span>speed</span>
            <input
              type="range"
              min={1}
              max={60}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="w-6 tabular-nums">{speed}</span>
          </label>
          <span className={status === 'ready' ? 'ml-2 text-[#9ece6a]' : 'ml-2 text-white/50'}>
            {status}
          </span>
          {status === 'ready' ? <span className="ml-2 text-[#7aa2f7]">{fps} fps</span> : null}
          {error ? <span className="ml-2 text-[#f7768e]">{error}</span> : null}
        </div>
      </div>
      <div ref={hostRef} className="flex-1 overflow-hidden rounded-md border border-white/5" />
    </div>
  )
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
    1,
  ]
}
