import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { drawMandelbrot } from '../demo-lib/mandelbrot-kernel'
import { VariantToggle } from '../demo-lib/VariantToggle'
import {
  CanvasVariant,
  GhosttyVariant,
  GhosttyWorkerVariant,
} from '../demo-lib/variants'

export const Route = createFileRoute('/mandelbrot')({ component: MandelbrotPage })

type Variant = 'ghostty' | 'ghostty-worker' | 'canvas'

const VARIANTS: ReadonlyArray<{ key: Variant; label: string; hint: string }> = [
  { key: 'ghostty', label: 'ghostty', hint: 'ghostty-web on main thread' },
  { key: 'ghostty-worker', label: 'ghostty / worker', hint: 'opentui compute in a Worker, ghostty-web paints' },
  { key: 'canvas', label: 'canvas', hint: 'direct 2d canvas paint, no terminal emulator' },
]

const mandelbrotWorkerFactory = () =>
  new Worker(new URL('../workers/mandelbrot-worker.ts', import.meta.url), { type: 'module' })

function MandelbrotPage() {
  const [variant, setVariant] = useState<Variant>('ghostty-worker')
  return (
    <div className="flex flex-1 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <span className="font-mono text-sm">mandelbrot</span>
          <span className="ml-3 font-mono text-xs text-white/40">
            animated zoom · ~96 iter/pixel · per-pixel compute is heavy
          </span>
        </div>
        <VariantToggle value={variant} options={VARIANTS} onChange={setVariant} />
      </div>
      {variant === 'ghostty' && <GhosttyVariant key="ghostty" draw={drawMandelbrot} />}
      {variant === 'ghostty-worker' && <GhosttyWorkerVariant key="ghostty-worker" workerFactory={mandelbrotWorkerFactory} />}
      {variant === 'canvas' && <CanvasVariant key="canvas" draw={drawMandelbrot} />}
    </div>
  )
}
