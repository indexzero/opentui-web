import { createFileRoute } from '@tanstack/react-router'
import { useRef } from 'react'
import { useOpentuiTerminal } from '../demo-lib/useOpentuiTerminal'
import { DemoFrame } from '../demo-lib/DemoLayout'
import { drawBar, drawBorder, drawSparkline, drawString, fillRect, hsv } from '../demo-lib/draw-primitives'
import type { RGBA } from 'opentui-browser'

export const Route = createFileRoute('/dashboard')({ component: Dashboard })

const COLS = 110
const ROWS = 28

// Explicit panel layout — for a real layout engine we'd pull in yoga-layout's WASM,
// but for a fixed scene like this hard-coded rectangles are simpler and don't
// hide what's happening. Each panel knows its (x, y, w, h).
const P = {
  header: { x: 0, y: 0, w: COLS, h: 3 },
  gauges: { x: 0, y: 3, w: 60, h: 14 },
  spark: { x: 0, y: 17, w: 60, h: 11 },
  plasma: { x: 60, y: 3, w: 50, h: 16 },
  log: { x: 60, y: 19, w: 50, h: 9 },
}

const BG: RGBA = [0.04, 0.04, 0.08, 1]
const PANEL_BG: RGBA = [0.06, 0.07, 0.11, 1]
const TRACK: RGBA = [0.13, 0.14, 0.21, 1]
const ACCENT: RGBA = [0.48, 0.61, 0.97, 1] // tokyonight blue
const ACCENT_DIM: RGBA = [0.24, 0.3, 0.5, 1]
const TEXT: RGBA = [0.76, 0.79, 0.96, 1]
const TEXT_DIM: RGBA = [0.46, 0.49, 0.62, 1]
const GREEN: RGBA = [0.62, 0.81, 0.42, 1]
const ORANGE: RGBA = [0.97, 0.71, 0.45, 1]
const RED: RGBA = [0.97, 0.46, 0.55, 1]
const PURPLE: RGBA = [0.74, 0.6, 0.97, 1]
const CYAN: RGBA = [0.49, 0.83, 0.94, 1]

const METRICS = [
  { key: 'CPU', color: ACCENT, freq: 0.7, phase: 0, bias: 0.55 },
  { key: 'MEM', color: PURPLE, freq: 0.3, phase: 1.2, bias: 0.65 },
  { key: 'NET', color: GREEN, freq: 1.5, phase: 2.3, bias: 0.4 },
  { key: 'DSK', color: ORANGE, freq: 0.5, phase: 3.7, bias: 0.3 },
] as const

const HISTORY_LEN = P.spark.w - 4

const LOG_LINES = [
  'systemd[1]      started session 42',
  'kernel          eth0: link up @ 1000Mbps',
  'sshd[8132]      accepted publickey from 10.0.0.7',
  'opentui         render frame 12480 in 1.4ms',
  'ghostty-web     vt parser cycle ok',
  'cron            wasm gc completed',
  'systemd-udevd   /dev/loop3 attached',
  'NetworkManager  carrier detected on wlp4s0',
  'audit           policy reloaded',
  'opentui         wasm32-freestanding ready',
]

function Dashboard() {
  // History buffers for the sparkline — kept in a ref so React doesn't re-render
  // each frame. The draw callback pushes new samples directly.
  const history = useRef<number[]>([])
  const logScroll = useRef(0)

  const { hostRef, status, error, fps } = useOpentuiTerminal({
    cols: COLS,
    rows: ROWS,
    hideCursor: true,
    draw: ({ buf, t, frame }) => {
      // Background
      fillRect(buf, 0, 0, COLS, ROWS, BG)

      // ---------- Header ----------
      fillRect(buf, P.header.x, P.header.y, P.header.w, P.header.h, PANEL_BG)
      const titleText = 'opentui · system overview'
      drawString(buf, titleText, 2, 1, TEXT, PANEL_BG, 1)
      const clockText = formatTime(t)
      drawString(buf, clockText, COLS - clockText.length - 2, 1, ACCENT, PANEL_BG, 1)
      for (let i = 0; i < COLS; i++) buf.setCell(i, 2, 0x2500, ACCENT_DIM, PANEL_BG, 0)

      // ---------- Gauges ----------
      drawBorder(buf, P.gauges.x, P.gauges.y, P.gauges.w, P.gauges.h, ACCENT_DIM, 'gauges')
      const gaugeStartY = P.gauges.y + 2
      const rowH = 3
      let cpuValue = 0
      for (let i = 0; i < METRICS.length; i++) {
        const m = METRICS[i]!
        const v = clamp01(m.bias + 0.35 * Math.sin(t * m.freq + m.phase) + 0.05 * Math.sin(t * m.freq * 3))
        if (m.key === 'CPU') cpuValue = v
        const y = gaugeStartY + i * rowH
        drawString(buf, m.key, P.gauges.x + 3, y, TEXT, PANEL_BG, 1)
        drawBar(buf, P.gauges.x + 8, y, P.gauges.w - 18, v, m.color, TRACK)
        const pct = `${Math.round(v * 100).toString().padStart(3, ' ')}%`
        drawString(buf, pct, P.gauges.x + P.gauges.w - 6, y, m.color, PANEL_BG, 1)
      }

      // ---------- Sparkline ----------
      if (frame % 2 === 0) {
        history.current.push(cpuValue)
        if (history.current.length > HISTORY_LEN) history.current.shift()
      }
      drawBorder(buf, P.spark.x, P.spark.y, P.spark.w, P.spark.h, ACCENT_DIM, 'cpu history')
      // Three sparkline rows at different scales for visual texture.
      const sparkY = P.spark.y + 2
      drawSparkline(buf, P.spark.x + 2, sparkY, HISTORY_LEN, history.current, ACCENT, PANEL_BG)
      drawSparkline(buf, P.spark.x + 2, sparkY + 2, HISTORY_LEN, history.current.map((v) => v * 0.7), CYAN, PANEL_BG)
      drawSparkline(buf, P.spark.x + 2, sparkY + 4, HISTORY_LEN, history.current.map((v) => 1 - v), PURPLE, PANEL_BG)
      drawString(buf, `peak ${(Math.max(0, ...history.current) * 100).toFixed(0)}%`, P.spark.x + 2, P.spark.y + P.spark.h - 2, TEXT_DIM, PANEL_BG, 0)
      drawString(buf, `avg ${(avg(history.current) * 100).toFixed(0)}%`, P.spark.x + 18, P.spark.y + P.spark.h - 2, TEXT_DIM, PANEL_BG, 0)

      // ---------- Mini plasma ----------
      drawBorder(buf, P.plasma.x, P.plasma.y, P.plasma.w, P.plasma.h, ACCENT_DIM, 'plasma')
      const innerX = P.plasma.x + 1
      const innerY = P.plasma.y + 1
      const innerW = P.plasma.w - 2
      const innerH = P.plasma.h - 2
      for (let y = 0; y < innerH; y++) {
        for (let x = 0; x < innerW; x++) {
          const topV =
            Math.sin(x * 0.12 + t * 1.2) +
            Math.sin((x + y * 2) * 0.08 + t * 1.6) +
            Math.sin(Math.hypot(x - innerW / 2, y * 2 - innerH) * 0.18 + t * 1.4)
          const botV =
            Math.sin(x * 0.12 + t * 1.2) +
            Math.sin((x + (y * 2 + 1)) * 0.08 + t * 1.6) +
            Math.sin(Math.hypot(x - innerW / 2, y * 2 + 1 - innerH) * 0.18 + t * 1.4)
          const top = hsv(topV * 50 + t * 40, 0.75, 0.9)
          const bot = hsv(botV * 50 + t * 40, 0.75, 0.9)
          buf.setCell(
            innerX + x,
            innerY + y,
            0x2580, // upper half block
            [top[0], top[1], top[2], 1],
            [bot[0], bot[1], bot[2], 1],
            0,
          )
        }
      }

      // ---------- Log ----------
      drawBorder(buf, P.log.x, P.log.y, P.log.w, P.log.h, ACCENT_DIM, 'log')
      if (frame % 30 === 0) logScroll.current++
      const visibleLines = P.log.h - 2
      for (let i = 0; i < visibleLines; i++) {
        const idx = (logScroll.current + i) % LOG_LINES.length
        const line = LOG_LINES[idx]!
        const dim = i === 0
        const color: RGBA = dim ? TEXT_DIM : i === visibleLines - 1 ? GREEN : TEXT
        const truncated = line.length > P.log.w - 6 ? line.slice(0, P.log.w - 6) : line
        drawString(buf, truncated, P.log.x + 3, P.log.y + 1 + i, color, PANEL_BG, 0)
      }

      // Footer status indicator
      const statusText = `wasm 283kb · 60fps target · ${frame.toString().padStart(6, ' ')} frames`
      drawString(buf, statusText, COLS - statusText.length - 1, ROWS - 1, TEXT_DIM, BG, 0)
      drawString(buf, '●', 1, ROWS - 1, RED, BG, 1)
      drawString(buf, ' live', 2, ROWS - 1, TEXT, BG, 1)
    },
  })

  return (
    <DemoFrame
      title="dashboard"
      subtitle="multi-panel layout · gauges + sparkline + plasma + log"
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function avg(xs: number[]) {
  if (xs.length === 0) return 0
  let s = 0
  for (const v of xs) s += v
  return s / xs.length
}

function formatTime(t: number) {
  const total = Math.floor(t)
  const h = Math.floor(total / 3600) % 24
  const m = Math.floor(total / 60) % 60
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function pad(n: number) {
  return n.toString().padStart(2, '0')
}
