import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { createMatrixDraw } from '@indexzero/opentui-browser/kernels/matrix'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/matrix')({ component: MatrixPage })

const matrixWorkerFactory = () =>
  new Worker(new URL('../workers/matrix-worker.ts', import.meta.url), { type: 'module' })

function MatrixPage() {
  const draw = useMemo(() => createMatrixDraw(), [])
  return (
    <VariantPicker
      title="matrix"
      subtitle="rain · per-column drop state · half-width katakana glyphs"
      draw={draw}
      workerFactory={matrixWorkerFactory}
    />
  )
}
