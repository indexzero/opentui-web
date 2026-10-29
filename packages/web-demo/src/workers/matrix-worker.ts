import { createMatrixDraw } from '@indexzero/opentui-browser/kernels/matrix'
import { runWorker } from './run-worker'

const draw = createMatrixDraw()
runWorker((buf, t, frame) => draw(buf, t, frame))
