import { createFileRoute } from '@tanstack/react-router'
import { drawMandelbrot } from '../demo-lib/mandelbrot-kernel'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/mandelbrot')({ component: MandelbrotPage })

const mandelbrotWorkerFactory = () =>
  new Worker(new URL('../workers/mandelbrot-worker.ts', import.meta.url), { type: 'module' })

function MandelbrotPage() {
  return (
    <VariantPicker
      title="mandelbrot"
      subtitle="animated zoom · ~96 iter/pixel · worker shines here"
      draw={drawMandelbrot}
      workerFactory={mandelbrotWorkerFactory}
      defaultVariant="ghostty-worker"
    />
  )
}
