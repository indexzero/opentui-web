import { createFireDraw } from '../demo-lib/fire-kernel'
import { runWorker } from './run-worker'

const draw = createFireDraw()
runWorker((buf, t, frame) => draw(buf, t, frame))
