import { drawMandelbrot } from '@indexzero/opentui-browser/kernels/mandelbrot'
import { runWorker } from './run-worker'

runWorker((buf, t) => drawMandelbrot(buf, t))
