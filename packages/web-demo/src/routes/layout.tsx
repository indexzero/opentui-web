import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useOpentuiTerminal } from '../demo-lib/useOpentuiTerminal'
import { DemoFrame } from '../demo-lib/DemoLayout'
import {
  box,
  custom,
  drawBar,
  drawString,
  fillRect,
  hsv,
  layoutAndDraw,
  text,
} from 'opentui-browser'
import type { RGBA, SceneNode } from 'opentui-browser'

export const Route = createFileRoute('/layout')({ component: LayoutDemo })

const BG: RGBA = [0.04, 0.04, 0.08, 1]
const PANEL_BG: RGBA = [0.06, 0.07, 0.11, 1]
const TRACK: RGBA = [0.13, 0.14, 0.21, 1]
const ACCENT: RGBA = [0.48, 0.61, 0.97, 1]
const ACCENT_DIM: RGBA = [0.24, 0.3, 0.5, 1]
const TEXT: RGBA = [0.76, 0.79, 0.96, 1]
const TEXT_DIM: RGBA = [0.46, 0.49, 0.62, 1]
const GREEN: RGBA = [0.62, 0.81, 0.42, 1]
const PURPLE: RGBA = [0.74, 0.6, 0.97, 1]
const ORANGE: RGBA = [0.97, 0.71, 0.45, 1]

const SIDEBAR_ITEMS = ['Overview', 'Metrics', 'Logs', 'Editor', 'Settings']

function LayoutDemo() {
  // React state drives the scene tree. The active sidebar item cycles every 2s.
  const [active, setActive] = useState(0)
  const ringRef = useRef<number[]>([])

  // Auto-cycle sidebar selection so the screenshot shows a non-default state.
  useEffect(() => {
    const id = window.setInterval(() => setActive((i) => (i + 1) % SIDEBAR_ITEMS.length), 2200)
    return () => window.clearInterval(id)
  }, [])

  // Animated content for the "metrics" panel.
  const drawMetrics: (t: number) => Parameters<typeof custom>[0]['draw'] = (t) => (buf, rect) => {
    const innerX = rect.x + 2
    const innerW = rect.width - 4
    const labels = ['cpu', 'mem', 'net', 'i/o']
    for (let i = 0; i < labels.length; i++) {
      const y = rect.y + 1 + i * 2
      if (y >= rect.y + rect.height - 1) break
      const v = 0.5 + 0.4 * Math.sin(t * (1 + i * 0.3) + i)
      drawString(buf, labels[i]!, innerX, y, TEXT, PANEL_BG, 1)
      drawBar(buf, innerX + 5, y, Math.max(0, innerW - 12), Math.max(0, Math.min(1, v)), [0.48 + i * 0.1, 0.7 - i * 0.1, 0.95 - i * 0.05, 1], TRACK)
      const pct = `${Math.round(v * 100).toString().padStart(3, ' ')}%`
      drawString(buf, pct, innerX + innerW - 4, y, ACCENT, PANEL_BG, 1)
    }
  }

  const drawPlasma: (t: number) => Parameters<typeof custom>[0]['draw'] = (t) => (buf, rect) => {
    for (let yy = 0; yy < rect.height; yy++) {
      for (let xx = 0; xx < rect.width; xx++) {
        const a =
          Math.sin(xx * 0.16 + t * 1.4) +
          Math.sin((xx + yy * 2) * 0.1 + t * 1.7) +
          Math.sin(Math.hypot(xx - rect.width / 2, yy * 2 - rect.height) * 0.2 + t * 1.5)
        const b =
          Math.sin(xx * 0.16 + t * 1.4) +
          Math.sin((xx + (yy * 2 + 1)) * 0.1 + t * 1.7) +
          Math.sin(Math.hypot(xx - rect.width / 2, yy * 2 + 1 - rect.height) * 0.2 + t * 1.5)
        const top = hsv(a * 50 + t * 30, 0.7, 0.9)
        const bot = hsv(b * 50 + t * 30, 0.7, 0.9)
        buf.setCell(
          rect.x + xx,
          rect.y + yy,
          0x2580,
          [top[0], top[1], top[2], 1],
          [bot[0], bot[1], bot[2], 1],
          0,
        )
      }
    }
  }

  const drawRing: (t: number) => Parameters<typeof custom>[0]['draw'] = (t) => (buf, rect) => {
    // Spinner / activity ring: scrolling pulse along the perimeter.
    const ring = ringRef.current
    const perimeter = 2 * (rect.width + rect.height) - 4
    if (ring.length !== perimeter) {
      ring.length = perimeter
      for (let i = 0; i < perimeter; i++) ring[i] = 0
    }
    const head = Math.floor(t * 25) % perimeter
    for (let i = 0; i < perimeter; i++) {
      const age = (perimeter + head - i) % perimeter
      ring[i] = Math.max(0, 1 - age / 20)
    }
    let i = 0
    const setEdge = (px: number, py: number) => {
      const v = ring[i++] ?? 0
      const col: RGBA = [v * 0.95, v * 0.5, v + 0.05, 1]
      buf.setCell(px, py, 0x2588, col, PANEL_BG, 0)
    }
    for (let x = 0; x < rect.width; x++) setEdge(rect.x + x, rect.y)
    for (let y = 1; y < rect.height; y++) setEdge(rect.x + rect.width - 1, rect.y + y)
    for (let x = rect.width - 2; x >= 0; x--) setEdge(rect.x + x, rect.y + rect.height - 1)
    for (let y = rect.height - 2; y >= 1; y--) setEdge(rect.x, rect.y + y)
    drawString(buf, ' activity', rect.x + 2, rect.y + Math.floor(rect.height / 2) - 1, TEXT_DIM, PANEL_BG, 1)
    drawString(buf, `t = ${t.toFixed(1)}s`, rect.x + 2, rect.y + Math.floor(rect.height / 2) + 1, ACCENT, PANEL_BG, 1)
  }

  const scene: (t: number) => SceneNode = (t) =>
    box({
      direction: 'column',
      padding: 1,
      gap: 1,
      children: [
        // ----- top bar -----
        box({
          height: 3,
          direction: 'row',
          align: 'center',
          padding: 1,
          bg: PANEL_BG,
          border: { color: ACCENT, title: 'yoga layout · driven by flex' },
          children: [
            text({ content: 'opentui', color: ACCENT, attrs: 1 }),
            box({ flex: 1 }),
            text({ content: `tab: ${SIDEBAR_ITEMS[active]!}`, color: TEXT, attrs: 1 }),
            box({ width: 2 }),
            text({ content: 'live', color: GREEN, attrs: 1 }),
          ],
        }),

        // ----- main row -----
        box({
          flex: 1,
          direction: 'row',
          gap: 1,
          children: [
            // sidebar
            box({
              width: 22,
              direction: 'column',
              padding: 1,
              bg: PANEL_BG,
              border: { color: ACCENT_DIM, title: 'sidebar' },
              children: SIDEBAR_ITEMS.map((label, idx) =>
                box({
                  height: 1,
                  direction: 'row',
                  children: [
                    text({
                      content: (idx === active ? '▸ ' : '  ') + label,
                      color: idx === active ? ACCENT : TEXT_DIM,
                      attrs: idx === active ? 1 : 0,
                      width: 18,
                    }),
                  ],
                }),
              ),
            }),

            // main content column
            box({
              flex: 1,
              direction: 'column',
              gap: 1,
              children: [
                // metrics panel
                box({
                  height: 11,
                  direction: 'row',
                  gap: 1,
                  children: [
                    box({
                      flex: 2,
                      bg: PANEL_BG,
                      border: { color: ACCENT_DIM, title: 'metrics' },
                      children: [custom({ flex: 1, draw: drawMetrics(t) })],
                    }),
                    box({
                      flex: 1,
                      bg: PANEL_BG,
                      border: { color: ACCENT_DIM, title: 'activity' },
                      children: [custom({ flex: 1, draw: drawRing(t) })],
                    }),
                  ],
                }),

                // plasma fills the rest
                box({
                  flex: 1,
                  bg: PANEL_BG,
                  border: { color: ACCENT_DIM, title: 'plasma' },
                  children: [custom({ flex: 1, draw: drawPlasma(t) })],
                }),
              ],
            }),
          ],
        }),

        // ----- footer -----
        box({
          height: 1,
          direction: 'row',
          children: [
            text({ content: ' yoga + opentui WASM ', color: GREEN, attrs: 1 }),
            box({ flex: 1 }),
            text({ content: 'press tabs above to switch demos', color: TEXT_DIM }),
          ],
        }),
      ],
    })

  const { hostRef, status, error, fps } = useOpentuiTerminal({
    hideCursor: true,
    draw: ({ buf, t }) => {
      fillRect(buf, 0, 0, buf.width, buf.height, BG)
      layoutAndDraw(scene(t), buf)
      void PURPLE
      void ORANGE
    },
  })

  return (
    <DemoFrame
      title="layout"
      subtitle="yoga flex · sidebar / main / footer composed declaratively"
      status={status}
      fps={fps}
      error={error}
      hostRef={hostRef}
    />
  )
}
