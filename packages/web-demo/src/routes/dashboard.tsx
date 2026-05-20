import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { createDashboardDraw } from '../demo-lib/dashboard-kernel'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/dashboard')({ component: DashboardPage })

const dashboardWorkerFactory = () =>
  new Worker(new URL('../workers/dashboard-worker.ts', import.meta.url), { type: 'module' })

function DashboardPage() {
  const draw = useMemo(() => createDashboardDraw(), [])
  return (
    <VariantPicker
      title="dashboard"
      subtitle="multi-panel layout · gauges · sparkline · plasma · log"
      draw={draw}
      workerFactory={dashboardWorkerFactory}
      defaultEncoder="diff"
    />
  )
}
