import { createFileRoute } from '@tanstack/react-router'
import { drawCounter } from '../demo-lib/counter-kernel'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/counter')({ component: CounterPage })

const counterWorkerFactory = () =>
  new Worker(new URL('../workers/counter-worker.ts', import.meta.url), { type: 'module' })

function CounterPage() {
  return (
    <VariantPicker
      title="counter"
      subtitle="time-driven · big-pixel digits · same kernel across all variants"
      draw={drawCounter}
      workerFactory={counterWorkerFactory}
      defaultEncoder="diff"
    />
  )
}
