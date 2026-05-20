import { drawCounter } from '../demo-lib/counter-kernel'
import { runWorker } from './run-worker'

runWorker((buf, t) => drawCounter(buf, t))
