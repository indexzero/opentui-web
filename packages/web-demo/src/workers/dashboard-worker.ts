import { createDashboardDraw } from '../demo-lib/dashboard-kernel'
import { runWorker } from './run-worker'

const draw = createDashboardDraw()
runWorker((buf, t, frame) => draw(buf, t, frame))
