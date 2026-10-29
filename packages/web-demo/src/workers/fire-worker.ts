import { createFireDraw } from '@indexzero/opentui-browser/kernels/fire'
import { runWorker } from './run-worker'

const draw = createFireDraw()
runWorker((buf, t, frame) => draw(buf, t, frame))
