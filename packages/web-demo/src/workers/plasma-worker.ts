import { drawPlasma } from '@indexzero/opentui-browser/kernels/plasma'
import { runWorker } from './run-worker'

runWorker((buf, t) => drawPlasma(buf, t))
