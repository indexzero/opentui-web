// VariantPicker is the standard demo chrome: title + subtitle on the left,
// variant toggle and (where applicable) encoder toggle on the right. It owns
// the variant + encoderMode state and unmounts/remounts the variant component
// on change via the React key, so there's no stale state between variants.

import { useState } from 'react'
import { VariantToggle } from './VariantToggle'
import {
  CanvasGLVariant,
  CanvasGLWorkerVariant,
  CanvasGPUVariant,
  CanvasGPUWorkerVariant,
  CanvasVariant,
  CanvasWorkerVariant,
  GhosttyVariant,
  GhosttyWorkerVariant,
  XtermVariant,
} from './variants'

export type Variant =
  | 'ghostty'
  | 'ghostty-worker'
  | 'xterm'
  | 'canvas'
  | 'canvas-worker'
  | 'canvas-gl'
  | 'canvas-gl-worker'
  | 'canvas-gpu'
  | 'canvas-gpu-worker'
export type EncoderMode = 'full' | 'diff'

interface Props {
  title: string
  subtitle?: string
  draw: import('./variants').DrawKernel
  // Required for the ghostty-worker variant; pass null to disable that variant.
  workerFactory: (() => Worker) | null
  // Skip variants you don't support (e.g. interactive demos that don't have
  // a worker version, or layout demos that only make sense in canvas).
  available?: ReadonlyArray<Variant>
  defaultVariant?: Variant
  defaultEncoder?: EncoderMode
  // If set, terminal-variant components route keystrokes here. The worker
  // variant forwards them to the worker via postMessage (worker-side kernel
  // must declare an input handler via runWorker's second arg).
  onInput?: (data: string) => void
}

const ALL_VARIANTS: ReadonlyArray<{ key: Variant; label: string; hint: string }> = [
  { key: 'ghostty', label: 'ghostty', hint: 'ghostty-web on main thread' },
  { key: 'ghostty-worker', label: 'ghostty +worker', hint: 'opentui compute in a Worker, ghostty-web paints' },
  { key: 'xterm', label: 'xterm.js', hint: 'xterm.js v6 with WebGL addon' },
  { key: 'canvas', label: 'canvas2d', hint: 'direct 2d canvas paint, no terminal emulator' },
  { key: 'canvas-worker', label: 'canvas2d +worker', hint: 'canvas2d, worker computes the cell grid' },
  { key: 'canvas-gl', label: 'canvas-gl', hint: 'WebGL2 painter with instanced glyph atlas' },
  { key: 'canvas-gl-worker', label: 'canvas-gl +worker', hint: 'WebGL2, worker computes the cell grid' },
  { key: 'canvas-gpu', label: 'canvas-gpu', hint: 'WebGPU painter (Chrome/Edge/Safari TP)' },
  { key: 'canvas-gpu-worker', label: 'canvas-gpu +worker', hint: 'WebGPU, worker computes the cell grid' },
]

const ENCODER_OPTIONS: ReadonlyArray<{ key: EncoderMode; label: string; hint: string }> = [
  { key: 'full', label: 'full', hint: 're-emit every cell every frame' },
  { key: 'diff', label: 'diff', hint: 'emit only changed cells with cursor-position escapes' },
]

export function VariantPicker({
  title,
  subtitle,
  draw,
  workerFactory,
  available,
  defaultVariant = 'ghostty',
  defaultEncoder = 'full',
  onInput,
}: Props) {
  const allowed = available ?? ALL_VARIANTS.map((v) => v.key)
  const filtered = ALL_VARIANTS.filter((v) => allowed.includes(v.key) && (v.key !== 'ghostty-worker' || workerFactory !== null))
  const [variant, setVariant] = useState<Variant>(() => (filtered.find((v) => v.key === defaultVariant)?.key ?? filtered[0]!.key))
  const [encoderMode, setEncoderMode] = useState<EncoderMode>(defaultEncoder)

  // Direct-canvas variants don't go through any ANSI encoder; hide the toggle.
  const showEncoder = variant === 'ghostty' || variant === 'ghostty-worker' || variant === 'xterm'

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-sm">{title}</span>
          {subtitle ? (
            <span className="ml-3 font-mono text-xs text-white/40">{subtitle}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showEncoder ? (
            <VariantToggle value={encoderMode} options={ENCODER_OPTIONS} onChange={setEncoderMode} />
          ) : null}
          <VariantToggle value={variant} options={filtered} onChange={setVariant} />
        </div>
      </div>
      {variant === 'ghostty' && (
        <GhosttyVariant key={`ghostty-${encoderMode}`} draw={draw} encoderMode={encoderMode} onInput={onInput} />
      )}
      {variant === 'ghostty-worker' && workerFactory && (
        <GhosttyWorkerVariant
          key={`worker-${encoderMode}`}
          workerFactory={workerFactory}
          encoderMode={encoderMode}
          forwardInput={!!onInput}
        />
      )}
      {variant === 'xterm' && (
        <XtermVariant key={`xterm-${encoderMode}`} draw={draw} encoderMode={encoderMode} onInput={onInput} />
      )}
      {variant === 'canvas' && <CanvasVariant key="canvas" draw={draw} onInput={onInput} />}
      {variant === 'canvas-worker' && workerFactory && (
        <CanvasWorkerVariant key="canvas-worker" workerFactory={workerFactory} forwardInput={!!onInput} />
      )}
      {variant === 'canvas-gl' && <CanvasGLVariant key="canvas-gl" draw={draw} onInput={onInput} />}
      {variant === 'canvas-gl-worker' && workerFactory && (
        <CanvasGLWorkerVariant key="canvas-gl-worker" workerFactory={workerFactory} forwardInput={!!onInput} />
      )}
      {variant === 'canvas-gpu' && <CanvasGPUVariant key="canvas-gpu" draw={draw} onInput={onInput} />}
      {variant === 'canvas-gpu-worker' && workerFactory && (
        <CanvasGPUWorkerVariant key="canvas-gpu-worker" workerFactory={workerFactory} forwardInput={!!onInput} />
      )}
    </div>
  )
}
