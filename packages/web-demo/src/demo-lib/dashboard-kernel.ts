import type { OpentuiBuffer, RGBA } from 'opentui-browser'
import { drawBar, drawBorder, drawSparkline, drawString, fillRect, hsv } from 'opentui-browser'

const BG: RGBA = [0.04, 0.04, 0.08, 1]
const PANEL_BG: RGBA = [0.06, 0.07, 0.11, 1]
const TRACK: RGBA = [0.13, 0.14, 0.21, 1]
const ACCENT: RGBA = [0.48, 0.61, 0.97, 1]
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

function clamp01(v: number) { return Math.max(0, Math.min(1, v)) }
function avg(xs: number[]) {
  if (xs.length === 0) return 0
  let s = 0
  for (const v of xs) s += v
  return s / xs.length
}
function pad(n: number) { return n.toString().padStart(2, '0') }
function formatTime(t: number) {
  const total = Math.floor(t)
  const h = Math.floor(total / 3600) % 24
  const m = Math.floor(total / 60) % 60
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function computeLayout(cols: number, rows: number) {
  const headerH = 3
  const bodyH = Math.max(0, rows - headerH)
  const leftW = Math.floor(cols * 0.55)
  const rightW = cols - leftW
  const gaugesH = Math.min(2 + METRICS.length * 3, Math.floor(bodyH * 0.55))
  const plasmaH = Math.floor(bodyH * 0.58)
  return {
    header: { x: 0, y: 0, w: cols, h: headerH },
    gauges: { x: 0, y: headerH, w: leftW, h: gaugesH },
    spark: { x: 0, y: headerH + gaugesH, w: leftW, h: Math.max(3, bodyH - gaugesH) },
    plasma: { x: leftW, y: headerH, w: rightW, h: plasmaH },
    log: { x: leftW, y: headerH + plasmaH, w: rightW, h: Math.max(3, bodyH - plasmaH) },
  }
}

export function createDashboardDraw(): (buf: OpentuiBuffer, t: number, frame: number) => void {
  const history: number[] = []
  let logScroll = 0

  return (buf, t, frame) => {
    const cols = buf.width
    const rows = buf.height
    const P = computeLayout(cols, rows)

    fillRect(buf, 0, 0, cols, rows, BG)

    // Header
    fillRect(buf, P.header.x, P.header.y, P.header.w, P.header.h, PANEL_BG)
    drawString(buf, 'opentui · system overview', 2, 1, TEXT, PANEL_BG, 1)
    const clockText = formatTime(t)
    drawString(buf, clockText, cols - clockText.length - 2, 1, ACCENT, PANEL_BG, 1)
    for (let i = 0; i < cols; i++) buf.setCell(i, 2, 0x2500, ACCENT_DIM, PANEL_BG, 0)

    // Gauges
    drawBorder(buf, P.gauges.x, P.gauges.y, P.gauges.w, P.gauges.h, ACCENT_DIM, 'gauges')
    let cpuValue = 0
    const rowH = 3
    for (let i = 0; i < METRICS.length; i++) {
      const m = METRICS[i]!
      const v = clamp01(m.bias + 0.35 * Math.sin(t * m.freq + m.phase) + 0.05 * Math.sin(t * m.freq * 3))
      if (m.key === 'CPU') cpuValue = v
      const y = P.gauges.y + 2 + i * rowH
      if (y >= P.gauges.y + P.gauges.h - 1) break
      drawString(buf, m.key, P.gauges.x + 3, y, TEXT, PANEL_BG, 1)
      const barX = P.gauges.x + 8
      const barW = Math.max(0, P.gauges.w - 18)
      drawBar(buf, barX, y, barW, v, m.color, TRACK)
      const pct = `${Math.round(v * 100).toString().padStart(3, ' ')}%`
      drawString(buf, pct, P.gauges.x + P.gauges.w - 6, y, m.color, PANEL_BG, 1)
    }

    // Sparkline
    const histLen = Math.max(4, P.spark.w - 4)
    if (frame % 2 === 0) {
      history.push(cpuValue)
      if (history.length > histLen) history.shift()
    }
    drawBorder(buf, P.spark.x, P.spark.y, P.spark.w, P.spark.h, ACCENT_DIM, 'cpu history')
    const sparkY = P.spark.y + 2
    drawSparkline(buf, P.spark.x + 2, sparkY, histLen, history, ACCENT, PANEL_BG)
    if (P.spark.h >= 5) {
      drawSparkline(buf, P.spark.x + 2, sparkY + 2, histLen, history.map((v) => v * 0.7), CYAN, PANEL_BG)
    }
    if (P.spark.h >= 7) {
      drawSparkline(buf, P.spark.x + 2, sparkY + 4, histLen, history.map((v) => 1 - v), PURPLE, PANEL_BG)
    }
    if (P.spark.h >= 4) {
      drawString(buf, `peak ${(Math.max(0, ...history) * 100).toFixed(0)}%`, P.spark.x + 2, P.spark.y + P.spark.h - 2, TEXT_DIM, PANEL_BG, 0)
      drawString(buf, `avg ${(avg(history) * 100).toFixed(0)}%`, P.spark.x + 18, P.spark.y + P.spark.h - 2, TEXT_DIM, PANEL_BG, 0)
    }

    // Mini plasma
    drawBorder(buf, P.plasma.x, P.plasma.y, P.plasma.w, P.plasma.h, ACCENT_DIM, 'plasma')
    const innerX = P.plasma.x + 1
    const innerY = P.plasma.y + 1
    const innerW = Math.max(0, P.plasma.w - 2)
    const innerH = Math.max(0, P.plasma.h - 2)
    for (let y = 0; y < innerH; y++) {
      for (let x = 0; x < innerW; x++) {
        const top = hsv(
          (Math.sin(x * 0.12 + t * 1.2) +
            Math.sin((x + y * 2) * 0.08 + t * 1.6) +
            Math.sin(Math.hypot(x - innerW / 2, y * 2 - innerH) * 0.18 + t * 1.4)) * 50 + t * 40,
          0.75, 0.9,
        )
        const bot = hsv(
          (Math.sin(x * 0.12 + t * 1.2) +
            Math.sin((x + (y * 2 + 1)) * 0.08 + t * 1.6) +
            Math.sin(Math.hypot(x - innerW / 2, y * 2 + 1 - innerH) * 0.18 + t * 1.4)) * 50 + t * 40,
          0.75, 0.9,
        )
        buf.setCell(innerX + x, innerY + y, 0x2580,
          [top[0], top[1], top[2], 1], [bot[0], bot[1], bot[2], 1], 0)
      }
    }

    // Log
    drawBorder(buf, P.log.x, P.log.y, P.log.w, P.log.h, ACCENT_DIM, 'log')
    if (frame % 30 === 0) logScroll++
    const visibleLines = Math.max(0, P.log.h - 2)
    const maxLineW = Math.max(0, P.log.w - 6)
    for (let i = 0; i < visibleLines; i++) {
      const idx = (logScroll + i) % LOG_LINES.length
      const line = LOG_LINES[idx]!
      const color: RGBA = i === 0 ? TEXT_DIM : i === visibleLines - 1 ? GREEN : TEXT
      const truncated = line.length > maxLineW ? line.slice(0, maxLineW) : line
      drawString(buf, truncated, P.log.x + 3, P.log.y + 1 + i, color, PANEL_BG, 0)
    }

    const statusText = `wasm 297kb · ${cols}x${rows} · ${frame.toString().padStart(6, ' ')} frames`
    drawString(buf, statusText, cols - statusText.length - 1, rows - 1, TEXT_DIM, BG, 0)
    drawString(buf, '●', 1, rows - 1, RED, BG, 1)
    drawString(buf, ' live', 2, rows - 1, TEXT, BG, 1)
  }
}
