import { drawPlasma } from '../demo-lib/plasma-kernel'
import { runWorker } from './run-worker'

runWorker((buf, t) => drawPlasma(buf, t))
