import { createMatrixDraw } from '../demo-lib/matrix-kernel'
import { runWorker } from './run-worker'

const draw = createMatrixDraw()
runWorker((buf, t, frame) => draw(buf, t, frame))
