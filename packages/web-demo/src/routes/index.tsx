import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Terminal, init as initGhostty } from 'ghostty-web'
import { OpentuiBuffer, encodeBufferAsAnsi, loadOpentui } from 'opentui-browser'

export const Route = createFileRoute('/')({ component: Home })

let ghosttyReady: Promise<void> | null = null
function ensureGhostty() {
  if (!ghosttyReady) ghosttyReady = initGhostty()
  return ghosttyReady
}

const COLS = 80
const ROWS = 20

function Home() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let term: Terminal | undefined
    let buf: OpentuiBuffer | undefined
    let disposed = false

    Promise.all([ensureGhostty(), loadOpentui()])
      .then(([, opentui]) => {
        if (disposed || !hostRef.current) return

        term = new Terminal({
          fontSize: 14,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          cols: COLS,
          rows: ROWS + 4,
          theme: {
            background: '#16161e',
            foreground: '#c0caf5',
            cursor: '#7aa2f7',
          },
        })
        term.open(hostRef.current)

        buf = OpentuiBuffer.create(opentui, COLS, ROWS, { id: 'demo', widthMethod: 'unicode' })
        buf.clear([0.09, 0.09, 0.12, 1])

        // Background gradient: cool dark teal → indigo across columns.
        for (let y = 0; y < ROWS; y++) {
          for (let x = 0; x < COLS; x++) {
            const t = x / (COLS - 1)
            buf.setCell(
              x,
              y,
              0x20,
              [1, 1, 1, 1],
              [0.08 + 0.05 * t, 0.09 + 0.02 * t, 0.12 + 0.15 * t, 1],
              0,
            )
          }
        }

        // Border box drawn via direct cell sets so we exercise setCell + unicode width.
        const TL = 0x256d, TR = 0x256e, BL = 0x2570, BR = 0x256f, H = 0x2500, V = 0x2502
        const accent: [number, number, number, number] = [0.74, 0.6, 0.97, 1]
        const transparent: [number, number, number, number] = [0, 0, 0, 0]
        for (let x = 1; x < COLS - 1; x++) {
          buf.setCell(x, 0, H, accent, transparent, 1)
          buf.setCell(x, ROWS - 1, H, accent, transparent, 1)
        }
        for (let y = 1; y < ROWS - 1; y++) {
          buf.setCell(0, y, V, accent, transparent, 1)
          buf.setCell(COLS - 1, y, V, accent, transparent, 1)
        }
        buf.setCell(0, 0, TL, accent, transparent, 1)
        buf.setCell(COLS - 1, 0, TR, accent, transparent, 1)
        buf.setCell(0, ROWS - 1, BL, accent, transparent, 1)
        buf.setCell(COLS - 1, ROWS - 1, BR, accent, transparent, 1)

        // Text via opentui's grapheme-aware drawText.
        buf.drawText('opentui WASM → ghostty-web', 3, 2, [1, 1, 1, 1], 1)
        buf.drawText('end-to-end pipeline live ✓', 3, 4, [0.62, 0.81, 0.42, 1], 0)
        buf.drawText('• Zig core compiled to wasm32-freestanding', 3, 6, [0.67, 0.69, 0.84, 1], 0)
        buf.drawText('• OptimizedBuffer.setCell / drawText in the browser', 3, 7, [0.67, 0.69, 0.84, 1], 0)
        buf.drawText('• cell grid → ANSI in JS → ghostty parser → canvas', 3, 8, [0.67, 0.69, 0.84, 1], 0)
        buf.drawText('next: emit ANSI inside Zig (renderer.zig in wasm)', 3, 10, [0.65, 0.65, 0.71, 1], 2)

        // Drop the cursor below the buffer and write the encoded ANSI.
        term.write(encodeBufferAsAnsi(buf, { clearScreen: true }))
        term.write('\r\nopentui-browser :: live\r\n')

        setError(null)
        setStatus('ready')
      })
      .catch((err) => {
        setError(err?.message ?? String(err))
        setStatus('error')
      })

    return () => {
      disposed = true
      buf?.destroy()
      term?.dispose()
    }
  }, [])

  return (
    <div className="flex h-screen flex-col bg-[#16161e] text-[#c0caf5]">
      <header className="border-b border-white/5 px-4 py-3">
        <h1 className="font-mono text-sm">open-tui-ghostty-web · demo</h1>
        <p className="font-mono text-xs text-white/40">
          opentui WASM → ghostty-web ·{' '}
          <span className={status === 'ready' ? 'text-[#9ece6a]' : 'text-white/50'}>{status}</span>
          {error ? <span className="ml-2 text-[#f7768e]">{error}</span> : null}
        </p>
      </header>
      <main className="flex-1 overflow-hidden p-3">
        <div
          ref={hostRef}
          className="h-full w-full overflow-hidden rounded-md border border-white/5"
        />
      </main>
    </div>
  )
}
