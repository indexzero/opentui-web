// VariantPicker is the standard demo chrome: title + subtitle on the left,
// variant toggle and (where applicable) encoder toggle on the right. It owns
// the variant + encoderMode state and unmounts/remounts the variant component
// on change via the React key, so there's no stale state between variants.

import { useState } from 'react'
import { VariantToggle } from './VariantToggle'
import {
  CanvasVariant,
  GhosttyVariant,
  GhosttyWorkerVariant,
  XtermVariant,
} from './variants'

export type Variant = 'ghostty' | 'ghostty-worker' | 'xterm' | 'canvas'
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
}

const ALL_VARIANTS: ReadonlyArray<{ key: Variant; label: string; hint: string }> = [
  { key: 'ghostty', label: 'ghostty', hint: 'ghostty-web on main thread' },
  { key: 'ghostty-worker', label: 'ghostty / worker', hint: 'opentui compute in a Worker, ghostty-web paints' },
  { key: 'xterm', label: 'xterm.js', hint: 'xterm.js v6 with WebGL addon' },
  { key: 'canvas', label: 'canvas', hint: 'direct 2d canvas paint, no terminal emulator' },
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
}: Props) {
  const allowed = available ?? ALL_VARIANTS.map((v) => v.key)
  const filtered = ALL_VARIANTS.filter((v) => allowed.includes(v.key) && (v.key !== 'ghostty-worker' || workerFactory !== null))
  const [variant, setVariant] = useState<Variant>(() => (filtered.find((v) => v.key === defaultVariant)?.key ?? filtered[0]!.key))
  const [encoderMode, setEncoderMode] = useState<EncoderMode>(defaultEncoder)

  // Canvas variant doesn't go through any ANSI encoder; hide the toggle.
  const showEncoder = variant !== 'canvas'

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
      {variant === 'ghostty' && <GhosttyVariant key={`ghostty-${encoderMode}`} draw={draw} encoderMode={encoderMode} />}
      {variant === 'ghostty-worker' && workerFactory && (
        <GhosttyWorkerVariant key={`worker-${encoderMode}`} workerFactory={workerFactory} encoderMode={encoderMode} />
      )}
      {variant === 'xterm' && <XtermVariant key={`xterm-${encoderMode}`} draw={draw} encoderMode={encoderMode} />}
      {variant === 'canvas' && <CanvasVariant key="canvas" draw={draw} />}
    </div>
  )
}
