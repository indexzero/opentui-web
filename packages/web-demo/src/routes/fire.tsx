import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { createFireDraw } from '../demo-lib/fire-kernel'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/fire')({ component: FirePage })

const fireWorkerFactory = () =>
  new Worker(new URL('../workers/fire-worker.ts', import.meta.url), { type: 'module' })

function FirePage() {
  // The kernel closes over the heat field, which we want to keep alive across
  // resizes but only one instance per mount. useMemo gives that.
  const draw = useMemo(() => createFireDraw(), [])
  return (
    <VariantPicker
      title="fire"
      subtitle="palette-mapped cellular fire · seeded bottom row · upward cooling"
      draw={draw}
      workerFactory={fireWorkerFactory}
      defaultVariant="canvas"
    />
  )
}
