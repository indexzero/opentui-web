import { createFileRoute } from '@tanstack/react-router'
import { drawPlasma } from '../demo-lib/plasma-kernel'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/plasma')({ component: PlasmaPage })

const plasmaWorkerFactory = () =>
  new Worker(new URL('../workers/plasma-worker.ts', import.meta.url), { type: 'module' })

function PlasmaPage() {
  return (
    <VariantPicker
      title="plasma"
      subtitle="same kernel · pick a rendering pipeline · toggle encoder"
      draw={drawPlasma}
      workerFactory={plasmaWorkerFactory}
    />
  )
}
