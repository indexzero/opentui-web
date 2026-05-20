import { createLayoutKernel } from '../demo-lib/layout-kernel'
import { runWorker } from './run-worker'

const { draw, handleInput } = createLayoutKernel()
runWorker(draw, handleInput)
