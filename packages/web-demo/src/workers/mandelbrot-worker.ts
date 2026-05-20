import { drawMandelbrot } from '../demo-lib/mandelbrot-kernel'
import { runWorker } from './run-worker'

runWorker((buf, t) => drawMandelbrot(buf, t))
