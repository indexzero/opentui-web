import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { createLayoutKernel } from '../demo-lib/layout-kernel'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/layout')({ component: LayoutPage })

const layoutWorkerFactory = () =>
  new Worker(new URL('../workers/layout-worker.ts', import.meta.url), { type: 'module' })

function LayoutPage() {
  const { draw, handleInput } = useMemo(() => createLayoutKernel(), [])
  return (
    <VariantPicker
      title="layout"
      subtitle="yoga flex · sidebar · metrics · activity · editor · plasma"
      draw={draw}
      workerFactory={layoutWorkerFactory}
      onInput={handleInput}
      defaultEncoder="diff"
    />
  )
}
