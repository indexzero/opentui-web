import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { drawPlasma } from '../demo-lib/plasma-kernel'
import { VariantToggle } from '../demo-lib/VariantToggle'
import {
  CanvasVariant,
  GhosttyVariant,
  GhosttyWorkerVariant,
  XtermVariant,
} from '../demo-lib/variants'

export const Route = createFileRoute('/plasma')({ component: PlasmaPage })

type Variant = 'ghostty' | 'ghostty-worker' | 'xterm' | 'canvas'

const VARIANTS: ReadonlyArray<{ key: Variant; label: string; hint: string }> = [
  { key: 'ghostty', label: 'ghostty', hint: 'ghostty-web on main thread (default)' },
  { key: 'ghostty-worker', label: 'ghostty / worker', hint: 'opentui compute in a Worker, ghostty-web paints' },
  { key: 'xterm', label: 'xterm.js', hint: 'xterm.js v6 with WebGL addon' },
  { key: 'canvas', label: 'canvas', hint: 'direct 2d canvas paint, no terminal emulator' },
]

const plasmaWorkerFactory = () =>
  new Worker(new URL('../workers/plasma-worker.ts', import.meta.url), { type: 'module' })

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
      {variant === 'ghostty' && <GhosttyVariant key="ghostty" draw={drawPlasma} />}
      {variant === 'ghostty-worker' && <GhosttyWorkerVariant key="ghostty-worker" workerFactory={plasmaWorkerFactory} />}
      {variant === 'xterm' && <XtermVariant key="xterm" draw={drawPlasma} />}
      {variant === 'canvas' && <CanvasVariant key="canvas" draw={drawPlasma} />}
    </div>
  )
}
